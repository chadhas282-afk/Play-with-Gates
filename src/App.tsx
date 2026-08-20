import dagre from 'dagre';
import * as JoyrideModule from 'react-joyride';
import Peer from 'peerjs';
import '@xyflow/react/dist/style.css';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Background, BaseEdge, Controls, Handle, Panel, Position, ReactFlow, addEdge, getBezierPath, useEdgesState, useNodesState, useReactFlow } from '@xyflow/react';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Check, CheckCircle2, Clock, Copy, Cpu, FastForward, FolderOpen, HelpCircle, Network, Pause, Play, Radio, Save, Square, StepForward, Table, Target, Timer, Trash2, Trophy, Users, Video, Volume2, VolumeX, X } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Canvas } from '@react-three/fiber';
import { Box, Environment, Line as DreiLine, OrbitControls, Text } from '@react-three/drei';
import type { Connection, Edge, EdgeProps, Node, NodeTypes } from '@xyflow/react';
import type { Step } from 'react-joyride';
import type { DataConnection } from 'peerjs';
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));
const nodeWidth = 150;
const nodeHeight = 80;
const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'LR') => {
  dagreGraph.setGraph({ rankdir: direction, nodesep: 60, ranksep: 100 });
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });
  dagre.layout(dagreGraph);
  const newNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const newNode = {
      ...node,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
      };
    return newNode;
  });
  return { nodes: newNodes, edges };
};
type ClockListener = () => void;
class MasterClock {
  private listeners: ClockListener[] = [];
  private intervalId: number | null = null;
  private isRunning: boolean = true;
  public frequencyHz: number = 1;
  public subscribe(listener: ClockListener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }
  private tick = () => {
    if (!this.isRunning) return;
    this.listeners.forEach(l => l());
  }
  public setFrequency(hz: number) {
    this.frequencyHz = hz;
    this.restart();
  }
  public pause() {
    this.isRunning = false;
    this.stopInterval();
  }
  public play() {
    this.isRunning = true;
    this.restart();
  }
  public step() {
    this.pause();
    this.tick();
  }
  private stopInterval() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
  private restart() {
    this.stopInterval();
    if (this.isRunning) {
      this.intervalId = window.setInterval(this.tick, 1000 / this.frequencyHz);
    }
  }
}
const globalClock = new MasterClock();
globalClock.play();
const exportToVerilog = (nodes: Node[], edges: Edge[], moduleName = 'CustomCircuit'): string => {
   const inputs = nodes.filter(n => n.type === 'inputNode' || n.type === 'clockNode');
   const outputs = nodes.filter(n => n.type === 'outputNode');
   const gates = nodes.filter(n => n.type === 'gateNode');
   const dffs = nodes.filter(n => n.type === 'dffNode');
   let code = `module ${moduleName}(\n`;
   const inputNames = inputs.map(n => `in_${n.id.replace('node_', '').replace('auto_', 'a_')}`);
   const outputNames = outputs.map(n => `out_${n.id.replace('node_', '').replace('auto_', 'a_')}`);
   if (inputNames.length > 0) code += `  input ${inputNames.join(', ')},\n`;
   if (outputNames.length > 0) code += `  output ${outputNames.join(', ')}\n`;
   else code = code.replace(/,\n$/, '\n');
   code += `);\n\n`;
   const getSafeId = (id: string) => id.replace('node_', '').replace('auto_', 'a_').replace(/-/g, '_');
   const wires = nodes.filter(n => n.type !== 'inputNode' && n.type !== 'clockNode').map(n => `wire_${getSafeId(n.id)}`);
   if (wires.length > 0) {
      code += `  wire ${wires.join(', ')};\n\n`;
   }
   const getSourceWire = (targetId: string, handle?: string) => {
      const edge = edges.find(e => e.target === targetId && (!handle || e.targetHandle === handle));
      if (!edge) return "1'b0";
      const source = nodes.find(n => n.id === edge.source);
      if (!source) return "1'b0";
      if (source.type === 'inputNode' || source.type === 'clockNode') return `in_${getSafeId(source.id)}`;
      return `wire_${getSafeId(source.id)}`;
   };
   gates.forEach(g => {
      const wA = getSourceWire(g.id, 'a');
      const wB = getSourceWire(g.id, 'b');
      const wSel = getSourceWire(g.id, 'sel');
      const wOut = `wire_${getSafeId(g.id)}`;
      let expr = '';
      switch (g.data.type) {
         case 'AND': expr = `${wA} & ${wB}`; break;
         case 'OR': expr = `${wA} | ${wB}`; break;
         case 'NOT': expr = `~${wA}`; break;
         case 'NAND': expr = `~(${wA} & ${wB})`; break;
         case 'NOR': expr = `~(${wA} | ${wB})`; break;
         case 'XOR': expr = `${wA} ^ ${wB}`; break;
         case 'XNOR': expr = `~(${wA} ^ ${wB})`; break;
         case 'MUX': expr = `${wSel} ? ${wB} : ${wA}`; break;
      }
      code += `  assign ${wOut} = ${expr};\n`;
   });
   dffs.forEach(dff => {
      const wD = getSourceWire(dff.id, 'd');
      const wClk = getSourceWire(dff.id, 'clk');
      const wOut = `wire_${getSafeId(dff.id)}`;
      code += `\n  reg reg_${getSafeId(dff.id)};\n`;
      code += `  always @(posedge ${wClk}) begin\n`;
      code += `    reg_${getSafeId(dff.id)} <= ${wD};\n`;
      code += `  end\n`;
      code += `  assign ${wOut} = reg_${getSafeId(dff.id)};\n`;
   });
   code += `\n`;
   outputs.forEach(out => {
      const wIn = getSourceWire(out.id);
      code += `  assign out_${getSafeId(out.id)} = ${wIn};\n`;
   });
   code += `endmodule\n`;
   return code;
};
const simulateCircuit = (nodes: Node[], edges: Edge[], inputValues: number[]): number | null => {
  let currentNodes = JSON.parse(JSON.stringify(nodes));
  const inputNodes = currentNodes.filter((n: any) => n.type === 'inputNode').sort((a: any, b: any) => a.position.y - b.position.y);
  inputNodes.forEach((n: any, idx: number) => {
     n.data.value = inputValues[idx] ?? 0;
     n.data.output = inputValues[idx] ?? 0;
  });
  let settling = true;
  let iterations = 0;
  while (settling && iterations < 50) {
    settling = false;
    iterations++;
    currentNodes = currentNodes.map((node: any) => {
      if (node.type === 'inputNode') return node;
      const incomingEdges = edges.filter((e: any) => e.target === node.id);
      if (node.type === 'gateNode') {
        const valAEdge = incomingEdges.find((e: any) => e.targetHandle === 'a');
        const valBEdge = incomingEdges.find((e: any) => e.targetHandle === 'b');
        const sourceANode = currentNodes.find((n: any) => n.id === valAEdge?.source);
        const sourceBNode = currentNodes.find((n: any) => n.id === valBEdge?.source);
        const valA = sourceANode ? (sourceANode.data.output ?? sourceANode.data.value ?? 0) : 0;
        const valB = sourceBNode ? (sourceBNode.data.output ?? sourceBNode.data.value ?? 0) : 0;
        const newOutput = evaluateGate(node.data.type, [valA, valB]);
        if (newOutput !== node.data.output) {
          settling = true;
          return { ...node, data: { ...node.data, output: newOutput } };
        }
      }
      if (node.type === 'outputNode') {
        const valEdge = incomingEdges[0];
        const sourceNode = currentNodes.find((n: any) => n.id === valEdge?.source);
        const val = sourceNode ? (sourceNode.data.output ?? sourceNode.data.value ?? 0) : 0;
        if (val !== node.data.value) {
          settling = true;
          return { ...node, data: { ...node.data, value: val } };
        }
      }
      return node;
    });
  }
  const outputNode = currentNodes.find((n: any) => n.type === 'outputNode');
  if (!outputNode) return null;
  return outputNode.data.value ?? null;
};
const simulateCircuitMulti = (nodes: Node[], edges: Edge[], inputValues: number[]): number[] => {
  let currentNodes = JSON.parse(JSON.stringify(nodes));
  const inputNodes = currentNodes.filter((n: any) => n.type === 'inputNode').sort((a: any, b: any) => a.position.y - b.position.y);
  inputNodes.forEach((n: any, idx: number) => {
     n.data.value = inputValues[idx] ?? 0;
     n.data.output = inputValues[idx] ?? 0;
  });
  let settling = true;
  let iterations = 0;
  while (settling && iterations < 50) {
    settling = false;
    iterations++;
    currentNodes = currentNodes.map((node: any) => {
      if (node.type === 'inputNode') return node;
      const incomingEdges = edges.filter((e: any) => e.target === node.id);
      if (node.type === 'gateNode') {
        const valAEdge = incomingEdges.find((e: any) => e.targetHandle === 'a');
        const valBEdge = incomingEdges.find((e: any) => e.targetHandle === 'b');
        const sourceANode = currentNodes.find((n: any) => n.id === valAEdge?.source);
        const sourceBNode = currentNodes.find((n: any) => n.id === valBEdge?.source);
        const valA = sourceANode ? (sourceANode.data.output ?? sourceANode.data.value ?? 0) : 0;
        const valB = sourceBNode ? (sourceBNode.data.output ?? sourceBNode.data.value ?? 0) : 0;
        const newOutput = evaluateGate(node.data.type, [valA, valB]);
        if (newOutput !== node.data.output) {
          settling = true;
          return { ...node, data: { ...node.data, output: newOutput } };
        }
      }
      if (node.type === 'outputNode') {
        const valEdge = incomingEdges[0];
        const sourceNode = currentNodes.find((n: any) => n.id === valEdge?.source);
        const val = sourceNode ? (sourceNode.data.output ?? sourceNode.data.value ?? 0) : 0;
        if (val !== node.data.value) {
          settling = true;
          return { ...node, data: { ...node.data, value: val } };
        }
      }
      return node;
    });
  }
  const outputNodes = currentNodes.filter((n: any) => n.type === 'outputNode').sort((a: any, b: any) => a.position.y - b.position.y);
  return outputNodes.map((n: any) => n.data.value ?? 0);
};
type TokenType = 'VAR' | 'AND' | 'OR' | 'XOR' | 'NOT' | 'LPAREN' | 'RPAREN' | 'EOF';
interface Token {
  type: TokenType;
  value: string;
}
class Lexer {
  private pos = 0;
  private input: string;
  constructor(input: string) { this.input = input; }
  getNextToken(): Token {
    while (this.pos < this.input.length) {
      const char = this.input[this.pos];
      if (/\s/.test(char)) {
        this.pos++;
        continue;
      }
      if (/[a-zA-Z]/.test(char)) {
        let value = '';
        while (this.pos < this.input.length && /[a-zA-Z0-9_]/.test(this.input[this.pos])) {
          value += this.input[this.pos];
          this.pos++;
        }
        return { type: 'VAR', value };
      }
      if (char === '*' || char === '&') { this.pos++; return { type: 'AND', value: char }; }
      if (char === '+' || char === '|') { this.pos++; return { type: 'OR', value: char }; }
      if (char === '^') { this.pos++; return { type: 'XOR', value: char }; }
      if (char === '!' || char === '~') { this.pos++; return { type: 'NOT', value: char }; }
      if (char === '(') { this.pos++; return { type: 'LPAREN', value: char }; }
      if (char === ')') { this.pos++; return { type: 'RPAREN', value: char }; }
      throw new Error(`Unexpected character: ${char}`);
    }
    return { type: 'EOF', value: '' };
  }
}
export const GATE_TYPES = ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR', 'MUX'] as const;
export type GateType = typeof GATE_TYPES[number];
type ASTNode = 
  | { type: 'VAR', name: string }
  | { type: 'NOT', arg: ASTNode }
    | { type: 'OP', op: 'AND' | 'OR' | 'XOR', left: ASTNode, right: ASTNode };
class Parser {
  private currentToken: Token;
  private lexer: Lexer;
  constructor(lexer: Lexer) {
    this.lexer = lexer;
    this.currentToken = this.lexer.getNextToken();
  }
  private eat(type: TokenType) {
    if (this.currentToken.type === type) {
      this.currentToken = this.lexer.getNextToken();
    } else {
      throw new Error(`Unexpected token: ${this.currentToken.type}, expected ${type}`);
    }
  }
  private factor(): ASTNode {
    const token = this.currentToken;
    if (token.type === 'NOT') {
      this.eat('NOT');
      return { type: 'NOT', arg: this.factor() };
    } else if (token.type === 'VAR') {
      this.eat('VAR');
      return { type: 'VAR', name: token.value };
    } else if (token.type === 'LPAREN') {
      this.eat('LPAREN');
      const node = this.expr();
      this.eat('RPAREN');
      return node;
    }
    throw new Error(`Parse error at token: ${token.value}`);
  }
  private term(): ASTNode {
    let node = this.factor();
    while (this.currentToken.type === 'AND') {
      this.eat('AND');
      node = { type: 'OP', op: 'AND', left: node, right: this.factor() };
    }
    return node;
  }
  public expr(): ASTNode {
    let node = this.term();
    while (this.currentToken.type === 'OR' || this.currentToken.type === 'XOR') {
      const op = this.currentToken.type;
      this.eat(op);
      node = { type: 'OP', op: op as 'OR'|'XOR', left: this.term(), right: node };
    }
    return node;
  }
}
const buildCircuitFromExpression = (expression: string) => {
  const lexer = new Lexer(expression);
  const parser = new Parser(lexer);
  const ast = parser.expr();
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let nodeId = 0;
  const getId = () => `auto_${nodeId++}`;
  const inputs = new Map<string, Node>();
  const findVars = (node: ASTNode, vars: Set<string>) => {
    if (node.type === 'VAR') vars.add(node.name);
    else if (node.type === 'NOT') findVars(node.arg, vars);
    else { findVars(node.left, vars); findVars(node.right, vars); }
  };
  const uniqueVars = new Set<string>();
  findVars(ast, uniqueVars);
  let yPos = 100;
  Array.from(uniqueVars).sort().forEach(v => {
    const node: Node = {
      id: getId(),
      type: 'inputNode',
      position: { x: 100, y: yPos },
      data: { id: '', value: 0 },
    };
    node.data.id = node.id;
    inputs.set(v, node);
    nodes.push(node);
    yPos += 150;
  });
  const traverse = (astNode: ASTNode): { id: string, x: number, y: number } => {
    if (astNode.type === 'VAR') {