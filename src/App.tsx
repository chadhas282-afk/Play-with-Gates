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
         const inputNode = inputs.get(astNode.name)!;
      return { id: inputNode.id, x: inputNode.position.x, y: inputNode.position.y };
    }
    if (astNode.type === 'NOT') {
      const arg = traverse(astNode.arg);
      const newId = getId();
      const newX = arg.x + 200;
      const newY = arg.y;
      nodes.push({
        id: newId,
        type: 'gateNode',
        position: { x: newX, y: newY },
        data: { type: 'NOT', output: 0 }
      });
      edges.push({ id: `e_${arg.id}-${newId}`, source: arg.id, target: newId, targetHandle: 'a', animated: false, style: { strokeWidth: 4 } });
      return { id: newId, x: newX, y: newY };
    }
    const left = traverse(astNode.left);
    const right = traverse(astNode.right);
    const newId = getId();
    const newX = Math.max(left.x, right.x) + 200;
    const newY = (left.y + right.y) / 2;
    nodes.push({
      id: newId,
      type: 'gateNode',
      position: { x: newX, y: newY },
      data: { type: astNode.op, output: 0 }
    });
    edges.push({ id: `e_${left.id}-${newId}_a`, source: left.id, target: newId, targetHandle: 'a', animated: false, style: { strokeWidth: 4 } });
    edges.push({ id: `e_${right.id}-${newId}_b`, source: right.id, target: newId, targetHandle: 'b', animated: false, style: { strokeWidth: 4 } });
    return { id: newId, x: newX, y: newY };
  };
  const rootResult = traverse(ast);
  const outId = getId();
  nodes.push({
    id: outId,
    type: 'outputNode',
    position: { x: rootResult.x + 200, y: rootResult.y },
    data: { value: 0 }
  });
  edges.push({ id: `e_${rootResult.id}-${outId}`, source: rootResult.id, target: outId, animated: false, style: { strokeWidth: 4 } });
  return { nodes, edges };
};
function GlowingEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  animated
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={{ ...style, strokeDasharray: animated ? '5,5' : 'none' }} />
      {animated && (
        <>
          <circle r="6" fill="#4ade80" filter="drop-shadow(0 0 8px #22c55e)">
            <animateMotion dur="0.8s" repeatCount="indefinite" path={edgePath} />
          </circle>
          <circle r="3" fill="#ffffff">
            <animateMotion dur="0.8s" repeatCount="indefinite" path={edgePath} />
          </circle>
        </>
      )}
    </>
  );
}
function BusEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const busValue = (data?.busValue as number) || 0;
  const isActive = busValue > 0;
  return (
    <>
      <BaseEdge 
        path={edgePath} 
        markerEnd={markerEnd} 
        style={{
           ...style,
           strokeWidth: 8,
           stroke: isActive ? '#6366f1' : '#334155', 
           filter: isActive ? 'drop-shadow(0 0 8px rgba(99,102,241,0.8))' : 'none',
           transition: 'stroke 0.2s, filter 0.2s'
        }} 
      />
      {isActive && (
         <circle r="4" fill="#818cf8">
           <animateMotion dur="1.5s" repeatCount="indefinite" path={edgePath} />
         </circle>
      )}
    </>
  );
}
function InputNode({ data, id }: { data: { value: number; onToggle?: (id: string) => void }, id: string }) {
  const isHigh = data.value === 1;
  const { setNodes, updateNodeData } = useReactFlow();
  const handleToggle = () => {
    const newVal = data.value === 0 ? 1 : 0;
    updateNodeData(id, { value: newVal });
    if (data.onToggle) {
      data.onToggle(id);
    } else {
      setNodes((nds: any) => nds.map((n: any) => 
        n.id === id ? { ...n, data: { ...n.data, value: newVal } } : n
      ));
    }
  };
  return (
    <div className={cn(
      "px-4 py-2 rounded-lg border-2 shadow-lg transition-colors flex flex-col items-center gap-2",
      isHigh ? "border-neon-blue bg-slate-900 shadow-[0_0_25px_rgba(59,130,246,0.4)]" : "border-slate-700 bg-slate-900"
    )}>
      <span className="text-sm font-bold tracking-wider text-slate-400">IN</span>
      <button
        type="button"
        onClick={handleToggle}
        className={cn(
          "nodrag w-10 h-10 rounded-full flex items-center justify-center text-xl font-bold transition-all duration-300",
          isHigh ? "bg-neon-blue text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
        )}
      >
        {data.value ?? 0}
      </button>
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-slate-400 border-2 border-slate-900" />
    </div>
  );
}
function OutputNode({ data }: { data: { value: number } }) {
  const isHigh = data.value === 1;
  return (
    <div className={cn(
      "px-5 py-3 rounded-xl border-2 shadow-xl transition-colors flex flex-col items-center gap-3",
      isHigh ? "border-neon-green bg-slate-900 shadow-[0_0_25px_rgba(34,197,94,0.4)]" : "border-slate-700 bg-slate-900"
    )}>
        <Handle type="target" position={Position.Left} className="w-4 h-4 bg-slate-400 border-2 border-slate-900" />
      <span className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">Output</span>
      <div className="relative flex items-center justify-center">
        {isHigh && (
          <motion.div 
            initial={{ scale: 0.8, opacity: 0.8 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={{ repeat: Infinity, duration: 1.5, ease: "easeOut" }}
            className="absolute inset-0 rounded-full bg-neon-green"
          />
        )}
        <div className={cn(
          "relative w-12 h-12 rounded-full flex items-center justify-center text-xl font-black transition-all duration-300 z-10 border-2",
          isHigh 
            ? "bg-neon-green text-black border-green-400 shadow-[0_0_20px_rgba(34,197,94,1),inset_0_0_10px_rgba(255,255,255,0.5)]" 
            : "bg-slate-800 text-slate-600 border-slate-700 shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]"
        )}>
          {data.value ?? 0}
        </div>
      </div>
    </div>
  );
}
function GateNode({ data }: { data: { type: GateType; output: number } }) {
  const expectedInputs = getExpectedInputCount(data.type);
  const isHigh = data.output === 1;
  return (
    <div className={cn(
      "p-1 rounded-xl border-2 shadow-lg bg-slate-900 transition-colors flex items-center justify-center min-w-[140px] min-h-[90px] overflow-hidden",
      isHigh ? "border-neon-green shadow-[0_0_15px_rgba(34,197,94,0.2)]" : "border-slate-700"
    )}>
      {expectedInputs === 3 ? (
        <>
          <Handle type="target" position={Position.Left} id="a" style={{ top: '25%' }} className="w-3 h-3 bg-slate-400 border-2 border-slate-900" />
          <Handle type="target" position={Position.Left} id="b" style={{ top: '75%' }} className="w-3 h-3 bg-slate-400 border-2 border-slate-900" />
          <Handle type="target" position={Position.Bottom} id="sel" style={{ left: '50%' }} className="w-3 h-3 bg-neon-blue border-2 border-slate-900" />
        </>
      ) : expectedInputs === 2 ? (
        <>
        <Handle type="target" position={Position.Left} id="a" style={{ top: '35%' }} className="w-3 h-3 bg-slate-400 border-2 border-slate-900" />
          <Handle type="target" position={Position.Left} id="b" style={{ top: '65%' }} className="w-3 h-3 bg-slate-400 border-2 border-slate-900" />
        </>
      ) : (
        <Handle type="target" position={Position.Left} id="a" className="w-3 h-3 bg-slate-400 border-2 border-slate-900" />
      )}
      <div className="scale-75 origin-center pointer-events-none flex items-center justify-center w-full h-full -m-4">
         <GateVisualizer type={data.type} output={data.output} />
      </div>
      <Handle 
        type="source" 
        position={Position.Right} 
        className={cn("w-3 h-3 border-2 border-slate-900", isHigh ? "bg-neon-green" : "bg-slate-500")}
      />
    </div>
  );
}
function DelayNode({ data, id }: { data: { value: number; inVal?: number }, id: string }) {
  const isHigh = data.value === 1;
  const inVal = data.inVal ?? 0;
  const inValRef = useRef(inVal);
  inValRef.current = inVal;
  const { setNodes } = useReactFlow();
  useEffect(() => {
    return globalClock.subscribe(() => {
      setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, value: inValRef.current } } : n));
    });
  }, [id, setNodes]);
  return (
    <div className={cn(
      "px-4 py-2 rounded-lg border-2 shadow-lg bg-slate-900 transition-colors flex items-center gap-3",
      isHigh ? "border-yellow-400 shadow-[0_0_15px_rgba(250,204,21,0.3)]" : "border-slate-700"
    )}>
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-slate-400 border-2 border-slate-900" />
      <Clock className={cn("w-4 h-4", isHigh ? "text-yellow-400" : "text-slate-500")} />
      <span className="text-xs font-bold tracking-wider text-slate-400">DELAY</span>
      <div className={cn(
        "w-6 h-6 flex items-center justify-center rounded font-bold text-sm transition-colors",
        isHigh ? "bg-yellow-400 text-black" : "bg-slate-700 text-slate-300"
      )}>
        {data.value ?? 0}
      </div>
      <Handle 
        type="source" 
        position={Position.Right} 
        className={cn("w-3 h-3 border-2 border-slate-900", isHigh ? "bg-yellow-400" : "bg-slate-500")}
      />
    </div>
  );
}
function ClockNode({ data }: { data: { id: string; value: number; onToggle: (id: string, val: number) => void } }) {
  const isHigh = data.value === 1;
  const isHighRef = useRef(isHigh);
  isHighRef.current = isHigh;
  useEffect(() => {
    return globalClock.subscribe(() => {
      data.onToggle(data.id, isHighRef.current ? 0 : 1);
    });
  }, [data.id, data.onToggle]);
  return (
    <div className={cn(
      "px-4 py-2 rounded-lg border-2 shadow-lg bg-slate-900 transition-colors flex items-center gap-3",
      isHigh ? "border-neon-blue shadow-[0_0_15px_rgba(59,130,246,0.3)]" : "border-slate-700"
    )}>
      <Timer className={cn("w-4 h-4", isHigh ? "text-neon-blue" : "text-slate-500")} />
      <span className="text-sm font-bold tracking-wider text-slate-400">CLK</span>
      <div className={cn(
        "w-8 h-8 flex items-center justify-center rounded font-bold text-lg transition-colors",
        isHigh ? "bg-neon-blue text-black" : "bg-slate-700 text-slate-300"
      )}>
        {data.value ?? 0}
      </div>
      <Handle 
        type="source" 
        position={Position.Right} 
        className={cn("w-3 h-3 border-2 border-slate-900", isHigh ? "bg-neon-blue" : "bg-slate-500")}
      />
    </div>
  );
}
function DFFNode({ data }: { data: { output: number, prevClk: number } }) {
  const isHigh = data.output === 1;
  const isHighInv = data.output === 0;
  return (
    <div className={cn(
      "p-2 rounded-xl border-2 shadow-lg bg-slate-900 transition-colors flex flex-col items-center justify-center min-w-[120px] min-h-[90px] relative",
      isHigh ? "border-neon-blue shadow-[0_0_15px_rgba(59,130,246,0.3)]" : "border-slate-700"
    )}>
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-between py-4">
         <div className="flex items-center">
           <Handle type="target" position={Position.Left} id="d" className="w-3 h-3 bg-slate-400 border-2 border-slate-900 !relative !left-auto !transform-none" />
           <span className="text-xs font-bold text-slate-400 ml-1">D</span>
         </div>
         <div className="flex items-center">
           <Handle type="target" position={Position.Left} id="clk" className="w-3 h-3 bg-slate-400 border-2 border-slate-900 !relative !left-auto !transform-none" />
           <div className="w-0 h-0 border-t-4 border-t-transparent border-l-6 border-l-slate-400 border-b-4 border-b-transparent ml-1" />
         </div>
      </div>
      <div className="text-center">
        <div className="text-sm font-bold tracking-widest text-slate-300">D-FF</div>
      </div>
      <div className="absolute right-0 top-0 bottom-0 flex flex-col justify-between py-4 items-end">
         <div className="flex items-center">
           <span className="text-xs font-bold text-slate-400 mr-1">Q</span>
           <Handle type="source" position={Position.Right} id="q" className={cn("w-3 h-3 border-2 border-slate-900 !relative !right-auto !transform-none", isHigh ? "bg-neon-blue" : "bg-slate-500")} />
         </div>
         <div className="flex items-center">
           <span className="text-xs font-bold text-slate-400 mr-1">Q̅</span>
           <Handle type="source" position={Position.Right} id="qbar" className={cn("w-3 h-3 border-2 border-slate-900 !relative !right-auto !transform-none", isHighInv ? "bg-neon-blue" : "bg-slate-500")} />
         </div>
      </div>
    </div>
  );
}
function MacroNode({ data }: { data: { name: string, numInputs: number, numOutputs: number, outputVals: number[] } }) {
  return (
    <div className="p-4 rounded-xl border-2 border-neon-blue shadow-[0_0_15px_rgba(59,130,246,0.2)] bg-slate-900 text-center relative min-w-[100px] min-h-[80px] flex items-center justify-center">
      {Array.from({ length: data.numInputs }).map((_, i) => (
        <Handle key={`in-${i}`} type="target" position={Position.Left} id={`in-${i}`} style={{ top: `${((i + 1) / (data.numInputs + 1)) * 100}%` }} className="w-3 h-3 bg-slate-400 border-2 border-slate-900" />
      ))}
      {Array.from({ length: data.numOutputs }).map((_, i) => (
        <Handle key={`out-${i}`} type="source" position={Position.Right} id={`out-${i}`} style={{ top: `${((i + 1) / (data.numOutputs + 1)) * 100}%` }} className={cn("w-3 h-3 border-2 border-slate-900", data.outputVals?.[i] === 1 ? "bg-neon-green" : "bg-slate-500")} />
      ))}
      <span className="font-bold text-slate-200">{data.name}</span>
    </div>
  );
}
function BusMergerNode({ data }: { data: { inputVals?: number[], busValue?: number } }) {
  const inputs = data.inputVals || [0, 0, 0, 0];
  const busValue = (inputs[3] << 3) | (inputs[2] << 2) | (inputs[1] << 1) | inputs[0];
  return (
    <div className="p-2 rounded-lg border-2 border-indigo-500 bg-slate-900 shadow-xl flex items-center justify-between w-24">
      <div className="flex flex-col justify-around h-[80px]">
        {[0, 1, 2, 3].map(i => (
          <Handle 
            key={`in-${i}`} 
            type="target" 
            position={Position.Left} 
            id={`in-${i}`} 
            style={{ top: `${(i + 1) * 20}%` }} 
            className="w-2 h-2 bg-slate-400 border border-slate-900" 
          />
        ))}
      </div>
      <div className="flex flex-col items-center justify-center">
         <span className="text-[10px] font-bold text-indigo-400 tracking-tighter">MERGE</span>
         <span className="text-xs font-mono font-bold text-white bg-slate-800 px-1 rounded">{busValue.toString(16).toUpperCase()}</span>
      </div>
      <Handle 
        type="source" 
        position={Position.Right} 
        id="bus-out"
        className="w-4 h-4 bg-indigo-500 border-2 border-slate-900 rounded-none" 
      />
    </div>
  );
}
function BusSplitterNode({ data }: { data: { busValue?: number } }) {
  const busValue = data.busValue || 0;
  return (
     <div className="p-2 rounded-lg border-2 border-indigo-500 bg-slate-900 shadow-xl flex items-center justify-between w-24">
      <Handle 
        type="target" 
        position={Position.Left} 
        id="bus-in"
        className="w-4 h-4 bg-indigo-500 border-2 border-slate-900 rounded-none" 
      />
      <div className="flex flex-col items-center justify-center">
         <span className="text-[10px] font-bold text-indigo-400 tracking-tighter">SPLIT</span>
         <span className="text-xs font-mono font-bold text-white bg-slate-800 px-1 rounded">{busValue.toString(16).toUpperCase()}</span>
      </div>
      <div className="flex flex-col justify-around h-[80px]">
        {[0, 1, 2, 3].map(i => (
          <Handle 
            key={`out-${i}`} 
            type="source" 
            position={Position.Right} 
            id={`out-${i}`} 
            style={{ top: `${(i + 1) * 20}%` }} 
            className="w-2 h-2 bg-slate-400 border border-slate-900" 
          />
        ))}
      </div>
    </div>
  );
}
function ALUNode({ data }: { data: { busA?: number, busB?: number, op0?: number, op1?: number, out?: number, carry?: number } }) {
  const op0 = data.op0 || 0;
  const op1 = data.op1 || 0;
  const opCode = (op1 << 1) | op0;
  const getOpName = () => {
    switch(opCode) {
      case 0: return 'ADD';
      case 1: return 'SUB';
      case 2: return 'AND';
      case 3: return 'OR';
      default: return 'NOP';
    }
  };
  return (
     <div className="p-3 rounded-lg border-2 border-red-500 bg-slate-900 shadow-xl flex flex-col items-center justify-between min-w-[120px] min-h-[140px] relative">
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-around h-full">
         <Handle type="target" position={Position.Left} id="bus-a" style={{ top: '25%' }} className="w-4 h-4 bg-indigo-500 border-2 border-slate-900 rounded-none" />
         <Handle type="target" position={Position.Left} id="bus-b" style={{ top: '50%' }} className="w-4 h-4 bg-indigo-500 border-2 border-slate-900 rounded-none" />
      </div>
      <div className="absolute bottom-0 left-0 right-0 flex justify-center gap-4 w-full h-0">
         <Handle type="target" position={Position.Bottom} id="op-0" style={{ left: '35%' }} className="w-2 h-2 bg-slate-400 border border-slate-900" />
         <Handle type="target" position={Position.Bottom} id="op-1" style={{ left: '65%' }} className="w-2 h-2 bg-slate-400 border border-slate-900" />
      </div>
      <div className="absolute right-0 top-0 bottom-0 flex flex-col justify-around h-full">
         <Handle type="source" position={Position.Right} id="bus-out" style={{ top: '35%' }} className="w-4 h-4 bg-indigo-500 border-2 border-slate-900 rounded-none" />
         <Handle type="source" position={Position.Right} id="carry-out" style={{ top: '75%' }} className="w-2 h-2 bg-red-400 border border-slate-900" />
      </div>
      <span className="text-[10px] font-bold text-red-400 tracking-widest mt-1">4-BIT ALU</span>
      <div className="flex flex-col items-center mt-2 bg-slate-800 p-2 rounded w-full">
         <span className="text-[10px] text-slate-400">OP: {getOpName()}</span>
         <span className="text-xs font-mono font-bold text-white mt-1">OUT: {(data.out || 0).toString(16).toUpperCase()}</span>
      </div>
      <div className="flex justify-between w-full px-2 mt-2">
         <span className="text-[8px] text-slate-500">A/B</span>
         <span className="text-[8px] text-slate-500">C</span>
      </div>
    </div>
  );
}
function MemoryNode({ data }: { data: { addr?: number, dataIn?: number, we?: number, dataOut?: number } }) {
  const addr = data.addr || 0;
  return (
    <div className="p-3 rounded-lg border-2 border-emerald-500 bg-slate-900 shadow-xl flex flex-col items-center justify-between min-w-[140px] min-h-[160px] relative">
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-around h-full">
         <div className="relative"><span className="absolute left-5 text-[8px] text-slate-400 top-1/2 -translate-y-1/2">ADDR</span><Handle type="target" position={Position.Left} id="bus-addr" style={{ top: '25%' }} className="w-4 h-4 bg-indigo-500 border-2 border-slate-900 rounded-none" /></div>
         <div className="relative"><span className="absolute left-5 text-[8px] text-slate-400 top-1/2 -translate-y-1/2">DATA IN</span><Handle type="target" position={Position.Left} id="bus-data" style={{ top: '50%' }} className="w-4 h-4 bg-indigo-500 border-2 border-slate-900 rounded-none" /></div>
         <div className="relative"><span className="absolute left-5 text-[8px] text-slate-400 top-1/2 -translate-y-1/2">WE</span><Handle type="target" position={Position.Left} id="we" style={{ top: '80%' }} className="w-2 h-2 bg-emerald-400 border border-slate-900" /></div>
      </div>
      <div className="absolute right-0 top-0 bottom-0 flex flex-col justify-center h-full">
         <div className="relative"><span className="absolute right-5 text-[8px] text-slate-400 top-1/2 -translate-y-1/2">DATA OUT</span><Handle type="source" position={Position.Right} id="bus-out" style={{ top: '50%' }} className="w-4 h-4 bg-indigo-500 border-2 border-slate-900 rounded-none" /></div>
      </div>
      <span className="text-[10px] font-bold text-emerald-400 tracking-widest mt-1 ml-4">16B RAM</span>
      <div className="flex flex-col items-center mt-4 bg-slate-800 p-2 rounded w-[80%] ml-4 border-2 border-slate-700">
         <span className="text-[10px] text-slate-400">0x{addr.toString(16).toUpperCase()}</span>
         <span className="text-xs font-mono font-bold text-emerald-400 mt-1">{(data.dataOut || 0).toString(16).toUpperCase().padStart(2, '0')}</span>
      </div>
    </div>
  );
}
function CodeNode({ id, data }: { id: string, data: { code?: string, output?: number, error?: string } }) {
  const code = data.code || 'return (A & B) | C;';
  const { setNodes } = useReactFlow();
  const handleCodeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newCode = e.target.value;
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, code: newCode } } : n));
  };
  return (
    <div className="p-3 rounded-lg border-2 border-fuchsia-500 bg-slate-900 shadow-xl flex flex-col min-w-[200px] min-h-[160px] relative">
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-around h-full">
         <div className="relative"><span className="absolute left-3 text-[8px] text-slate-400 top-1/2 -translate-y-1/2">A</span><Handle type="target" position={Position.Left} id="in-a" style={{ top: '20%' }} className="w-2 h-2 bg-slate-400 border border-slate-900" /></div>
         <div className="relative"><span className="absolute left-3 text-[8px] text-slate-400 top-1/2 -translate-y-1/2">B</span><Handle type="target" position={Position.Left} id="in-b" style={{ top: '40%' }} className="w-2 h-2 bg-slate-400 border border-slate-900" /></div>
         <div className="relative"><span className="absolute left-3 text-[8px] text-slate-400 top-1/2 -translate-y-1/2">C</span><Handle type="target" position={Position.Left} id="in-c" style={{ top: '60%' }} className="w-2 h-2 bg-slate-400 border border-slate-900" /></div>
         <div className="relative"><span className="absolute left-3 text-[8px] text-slate-400 top-1/2 -translate-y-1/2">D</span><Handle type="target" position={Position.Left} id="in-d" style={{ top: '80%' }} className="w-2 h-2 bg-slate-400 border border-slate-900" /></div>
      </div>
      <div className="absolute right-0 top-0 bottom-0 flex flex-col justify-center h-full">
         <div className="relative"><span className="absolute right-4 text-[8px] text-slate-400 top-1/2 -translate-y-1/2">OUT</span><Handle type="source" position={Position.Right} id="out" style={{ top: '50%' }} className="w-3 h-3 bg-fuchsia-400 border-2 border-slate-900" /></div>
      </div>
      <div className="flex justify-between items-center ml-4 mr-6">
        <span className="text-[10px] font-bold text-fuchsia-400 tracking-widest">CUSTOM SCRIPT</span>
        <span className={cn("text-xs font-mono font-bold px-1 rounded", data.error ? "bg-red-900/50 text-red-400" : "bg-slate-800 text-fuchsia-400")}>
           {data.error ? 'ERR' : (data.output || 0)}
        </span>
      </div>
      <textarea 
         className={cn(
            "mt-2 ml-4 mr-6 flex-1 bg-slate-950 border rounded p-1 text-xs font-mono text-slate-300 outline-none resize-none custom-scrollbar focus:border-fuchsia-500",
            data.error ? "border-red-500/50" : "border-slate-700"
         )}
         value={code}
         onChange={handleCodeChange}
         spellCheck={false}
      />
    </div>
  );

interface DataPoint {
  time: number;
  ch1: number;
  ch2: number;
  ch3: number;
  ch4: number;
}
function OscilloscopeNode({ data }: { data: { history?: DataPoint[] } }) {
  const history = data.history || [];
  return (
    <div className="p-3 rounded-lg border-2 border-cyan-500 bg-slate-900 shadow-xl flex flex-col w-[350px] h-[220px] relative">
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-around h-full py-4">
         <div className="relative"><span className="absolute left-3 text-[8px] text-cyan-400 font-bold -translate-y-1/2 top-1/2">CH1</span><Handle type="target" position={Position.Left} id="ch-1" style={{ top: '20%' }} className="w-2 h-2 bg-cyan-400 border border-slate-900" /></div>
         <div className="relative"><span className="absolute left-3 text-[8px] text-fuchsia-400 font-bold -translate-y-1/2 top-1/2">CH2</span><Handle type="target" position={Position.Left} id="ch-2" style={{ top: '40%' }} className="w-2 h-2 bg-fuchsia-400 border border-slate-900" /></div>
         <div className="relative"><span className="absolute left-3 text-[8px] text-yellow-400 font-bold -translate-y-1/2 top-1/2">CH3</span><Handle type="target" position={Position.Left} id="ch-3" style={{ top: '60%' }} className="w-2 h-2 bg-yellow-400 border border-slate-900" /></div>
         <div className="relative"><span className="absolute left-3 text-[8px] text-emerald-400 font-bold -translate-y-1/2 top-1/2">CH4</span><Handle type="target" position={Position.Left} id="ch-4" style={{ top: '80%' }} className="w-2 h-2 bg-emerald-400 border border-slate-900" /></div>
      </div>
      <div className="flex items-center gap-2 ml-6 mb-2">
         <Activity className="w-4 h-4 text-cyan-500" />
         <span className="text-[10px] font-bold text-cyan-500 tracking-widest">OSCILLOSCOPE</span>
      </div>
      <div className="flex-1 ml-6 bg-slate-950 rounded border border-slate-700 overflow-hidden relative">
         <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history} margin={{ top: 10, right: 10, left: -30, bottom: 0 }}>
               <XAxis dataKey="time" hide />
               <YAxis domain={[-0.2, 1.2]} hide />
               <Tooltip 
                 contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }}
                 itemStyle={{ fontSize: '10px', fontWeight: 'bold' }}
                 labelStyle={{ display: 'none' }}
               />
               <Line type="stepAfter" dataKey="ch1" stroke="#22d3ee" strokeWidth={2} dot={false} isAnimationActive={false} />
               <Line type="stepAfter" dataKey="ch2" stroke="#e879f9" strokeWidth={2} dot={false} isAnimationActive={false} />
               <Line type="stepAfter" dataKey="ch3" stroke="#facc15" strokeWidth={2} dot={false} isAnimationActive={false} />
               <Line type="stepAfter" dataKey="ch4" stroke="#34d399" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
         </ResponsiveContainer>
      </div>
    </div>
    );
}
const SEGMENTS = {
  0: [1, 1, 1, 1, 1, 1, 0],
  1: [0, 1, 1, 0, 0, 0, 0],
  2: [1, 1, 0, 1, 1, 0, 1],
  3: [1, 1, 1, 1, 0, 0, 1],
  4: [0, 1, 1, 0, 0, 1, 1],
  5: [1, 0, 1, 1, 0, 1, 1],
  6: [1, 0, 1, 1, 1, 1, 1],
  7: [1, 1, 1, 0, 0, 0, 0],
  8: [1, 1, 1, 1, 1, 1, 1],
  9: [1, 1, 1, 1, 0, 1, 1],
  10: [1, 1, 1, 0, 1, 1, 1], 
  11: [0, 0, 1, 1, 1, 1, 1], 
  12: [1, 0, 0, 1, 1, 1, 0], 
  13: [0, 1, 1, 1, 1, 0, 1], 
  14: [1, 0, 0, 1, 1, 1, 1], 
  15: [1, 0, 0, 0, 1, 1, 1], 
};
function SegmentDisplayNode({ data }: { data: { inputVals?: number[] } }) {
  const inputs = data.inputVals || [0, 0, 0, 0];
  const value = (inputs[3] << 3) | (inputs[2] << 2) | (inputs[1] << 1) | inputs[0];
  const activeSegments = SEGMENTS[value as keyof typeof SEGMENTS] || SEGMENTS[0];
  const segClass = (active: number) => cn(
    "transition-colors duration-200", 
    active ? "fill-neon-blue drop-shadow-[0_0_8px_rgba(59,130,246,1)]" : "fill-slate-800"
  );
  return (
    <div className="p-4 rounded-xl border-2 border-slate-700 bg-slate-900 shadow-xl flex items-center gap-4">
      <div className="flex flex-col justify-around h-[120px]">
        {[0, 1, 2, 3].map(i => (
          <Handle 
            key={`in-${i}`} 
            type="target" 
            position={Position.Left} 
            id={`in-${i}`} 
            style={{ top: `${(i + 1) * 20}%` }} 
            className="w-3 h-3 bg-slate-400 border-2 border-slate-900" 
          />
          ))}
      </div>
      <div className="relative w-16 h-24 bg-black rounded-lg p-2 border-2 border-slate-800 flex items-center justify-center">
        <svg viewBox="0 0 57 80" className="w-full h-full">
          <polygon points="11,6 46,6 42,10 15,10" className={segClass(activeSegments[0])} />
          <polygon points="48,8 48,38 44,34 44,12" className={segClass(activeSegments[1])} />
          <polygon points="48,42 48,72 44,68 44,46" className={segClass(activeSegments[2])} />
          <polygon points="11,74 46,74 42,70 15,70" className={segClass(activeSegments[3])} />
          <polygon points="9,42 9,72 13,68 13,46" className={segClass(activeSegments[4])} />
          <polygon points="9,8 9,38 13,34 13,12" className={segClass(activeSegments[5])} />
          <polygon points="11,40 15,36 42,36 46,40 42,44 15,44" className={segClass(activeSegments[6])} />
        </svg>
      </div>
    </div>
  );
}
let audioCtx: AudioContext | null = null;
const getAudioContext = () => {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioCtx;
};
function SynthNode({ data }: { data: { value: number; freq?: number }, id: string }) {
  const isHigh = data.value === 1;
  const oscRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const freq = data.freq || 440; 
  useEffect(() => {
    try {
      const ctx = getAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.value = 0; 
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      oscRef.current = osc;
      gainRef.current = gain;
    } catch (e) {
      console.error("Audio initialization failed:", e);
    }
    return () => {
      try {
        oscRef.current?.stop();
        oscRef.current?.disconnect();
        gainRef.current?.disconnect();
      } catch (e) {}
    };
  }, [freq]);
  useEffect(() => {
    if (!gainRef.current || !getAudioContext()) return;
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    if (isHigh && !isMuted) {
      if (ctx.state === 'suspended') ctx.resume();
      gainRef.current.gain.setTargetAtTime(0.1, now, 0.05);
    } else {
      gainRef.current.gain.setTargetAtTime(0, now, 0.05);
    }
  }, [isHigh, isMuted]);
  return (
    <div className={cn(
      "px-4 py-3 rounded-xl border-2 shadow-xl transition-colors flex flex-col items-center gap-2",
      isHigh ? "border-purple-500 bg-slate-900 shadow-[0_0_25px_rgba(168,85,247,0.4)]" : "border-slate-700 bg-slate-900"
    )}>
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-slate-400 border-2 border-slate-900" />
      <div className="flex items-center justify-between w-full gap-4">
        <span className="text-xs font-bold tracking-wider text-slate-400">SYNTH</span>
        <button 
          onClick={() => setIsMuted(!isMuted)} 
          className="text-slate-400 hover:text-white transition-colors nodrag"
        >
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </div>
      <div className={cn(
        "w-12 h-12 rounded-full border-4 flex items-center justify-center transition-all duration-100",
        isHigh && !isMuted ? "border-purple-500 bg-purple-500/20 scale-110" : "border-slate-700 bg-slate-800"
      )}>
        {isHigh && !isMuted && (
           <motion.div
             animate={{ scale: [1, 1.2, 1] }}
             transition={{ repeat: Infinity, duration: 0.2 }}
             className="w-4 h-4 rounded-full bg-purple-400"
           />
        )}
      </div>
      <div className="text-[10px] font-mono text-slate-500">{freq} Hz</div>
    </div>
  );
}
const Joyride = (JoyrideModule as any).default || (JoyrideModule as any).Joyride || JoyrideModule;
interface TutorialOverlayProps {
  run: boolean;
  onFinish: () => void;
}
function TutorialOverlay({ run, onFinish }: TutorialOverlayProps) {
  const steps: Step[] = [
    {
      target: 'body',
      content: 'Welcome to Play with Gates! Let\'s take a quick tour of your new digital logic sandbox.',
      placement: 'center',
    },
    {
      target: '#tour-sidebar',
      content: 'Here you can drag and drop Inputs, Logic Gates, Master Clocks, Multi-Bit Buses, and even fully programmable ICs onto the canvas!',
      placement: 'right',
    },
    {
      target: '#tour-clock-panel',
      content: 'The Master Clock panel controls time in the simulation. Play, pause, or step through logic ticks, and adjust the frequency up to 20Hz.',
      placement: 'bottom',
    },
    {
      target: '#tour-actions',
      content: 'The Canvas Actions panel provides powerful tools like Auto-Tidy (Dagre layout) and Truth Table analysis.',
      placement: 'left',
    },
    {
      target: '#tour-multiplayer',
      content: 'Click here to generate a P2P Serverless Room ID, and invite your friends to collaborate on your circuit in real-time!',
      placement: 'left',
    },
    {
      target: '#tour-record',
      content: 'Finished your masterpiece? Click Record to capture the canvas as a WebM video and share it online!',
      placement: 'left',
    }
  ];
  return (
    <Joyride
      steps={steps}
      run={run}
      continuous={true}
      showSkipButton={true}
      showProgress={true}
      styles={{
        options: {
          primaryColor: '#3b82f6', 
          backgroundColor: '#0f172a', 
          textColor: '#f1f5f9', 
          arrowColor: '#0f172a',
          overlayColor: 'rgba(0, 0, 0, 0.7)',
        },
        buttonClose: { display: 'none' },
        tooltip: { border: '2px solid #334155', borderRadius: '12px' }
      }}
      callback={(data) => {
        if (data.status === 'finished' || data.status === 'skipped') {
          onFinish();
        }
      }}
    />
  );
}
interface MultiplayerProps {
    nodes: Node[];
  edges: Edge[];
  setNodes: (nds: Node[]) => void;
  setEdges: (eds: Edge[]) => void;
}
function MultiplayerManager({ nodes, edges, setNodes, setEdges }: MultiplayerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [peerId, setPeerId] = useState<string | null>(null);
  const [joinId, setJoinId] = useState('');
  const [connection, setConnection] = useState<DataConnection | null>(null);
  const [copied, setCopied] = useState(false);
  const peerRef = useRef<Peer | null>(null);
  const isHost = useRef(false);
  const ignoreNextUpdate = useRef(false);
  useEffect(() => {
    peerRef.current = new Peer();
    peerRef.current.on('open', (id) => {
      setPeerId(id);
    });
    peerRef.current.on('connection', (conn) => {
      setupConnection(conn, true);
    });
    return () => {
      peerRef.current?.destroy();
    };
  }, []);
  const setupConnection = (conn: DataConnection, host: boolean) => {
    isHost.current = host;
    conn.on('open', () => {
      setConnection(conn);
      setIsOpen(false); 
      if (host) {
        conn.send({ type: 'sync', nodes, edges });
      }
    });
    conn.on('data', (data: any) => {
      if (data.type === 'sync') {
        ignoreNextUpdate.current = true;
        setNodes(data.nodes);
        setEdges(data.edges);
        }
    });
    conn.on('close', () => {
      setConnection(null);
    });
  };
  const handleJoin = () => {
    if (!peerRef.current || !joinId) return;
    const conn = peerRef.current.connect(joinId);
    setupConnection(conn, false);
  };
  const copyId = () => {
    if (peerId) {
      navigator.clipboard.writeText(peerId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  useEffect(() => {
    if (ignoreNextUpdate.current) {
      ignoreNextUpdate.current = false;
      return;
    }
    if (connection && connection.open) {
      connection.send({ type: 'sync', nodes, edges });
    }
  }, [nodes, edges, connection]);
  return (
    <>
      <button 
        onClick={() => setIsOpen(true)}
        className={cn(
          "absolute top-4 left-1/2 -translate-x-1/2 z-50 p-3 rounded-xl border-2 shadow-xl backdrop-blur-md flex items-center gap-2 font-bold transition-colors",
          connection 
             ? "bg-green-900/50 border-green-700 text-green-400 shadow-[0_0_15px_rgba(34,197,94,0.3)]" 
             : "bg-slate-900/90 border-slate-700 text-slate-400 hover:text-white"
        )}
      >
        <Radio className={cn("w-5 h-5", connection ? "animate-pulse" : "")} />
        {connection ? 'Connected (P2P)' : 'Multiplayer'}
      </button>
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-slate-900 border-2 border-slate-700 rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden"
            >
              <div className="p-4 border-b-2 border-slate-800 bg-slate-950 flex justify-between items-center">
                <h2 className="text-xl font-bold text-slate-200 flex items-center gap-2">
                  <Users className="text-neon-blue" /> P2P Multiplayer Room
                </h2>
                <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-white">&times;</button>
              </div>
              <div className="p-6 space-y-6">
                 {connection ? (
                   <div className="text-center space-y-4">
                     <div className="text-green-400 font-bold text-lg animate-pulse">Connection Active!</div>
                     <p className="text-slate-400 text-sm">You are currently syncing circuit state in real-time with another user via WebRTC.</p>
                     <button onClick={() => connection.close()} className="px-4 py-2 bg-red-900/50 text-red-400 rounded font-bold border border-red-800/50 w-full">Disconnect</button>
                   </div>
                 ) : (
                   <>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase">Host a Room (Your ID)</label>
                      <div className="flex bg-slate-800 border border-slate-700 rounded overflow-hidden">
                        <input type="text" readOnly value={peerId || 'Generating...'} className="bg-transparent p-2 text-slate-300 font-mono text-sm flex-1 outline-none" />
                        <button onClick={copyId} className="px-4 bg-slate-700 text-slate-300 hover:text-white transition-colors flex items-center gap-2">
                          {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                      <p className="text-xs text-slate-500">Send this ID to a friend to let them join your circuit.</p>
                    </div>
                    <div className="relative flex py-4 items-center">
                        <div className="flex-grow border-t border-slate-700"></div>
                        <span className="flex-shrink-0 mx-4 text-slate-500 text-xs font-bold uppercase">OR</span>
                        <div className="flex-grow border-t border-slate-700"></div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase">Join a Room</label>
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          placeholder="Paste Host ID..." 
                          value={joinId}
                          onChange={(e) => setJoinId(e.target.value)}
                          className="flex-1 bg-slate-800 border border-slate-700 p-2 rounded text-slate-300 font-mono text-sm outline-none focus:border-neon-blue" 
                        />
                        <button onClick={handleJoin} disabled={!joinId} className="px-4 bg-neon-blue text-black font-bold rounded hover:bg-blue-400 disabled:opacity-50">Join</button>
                      </div>
                    </div>
                   </>
                 )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
function ScreenRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser' },
        audio: false
      });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
        };
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `circuit-recording-${Date.now()}.webm`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        setIsRecording(false);
        stream.getTracks().forEach(track => track.stop());
      };
      stream.getVideoTracks()[0].onended = () => {
         if (mediaRecorderRef.current?.state === 'recording') {
            mediaRecorderRef.current.stop();
         }
      };
      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error starting screen recording", err);
    }
  };
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };
  return (
    <div id="tour-record" className="w-full">
      {isRecording ? (
        <button 
          onClick={stopRecording}
          className="w-full p-2 bg-red-900/40 text-red-400 rounded border border-red-500/50 text-sm font-bold flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(239,68,68,0.4)] animate-pulse"
        >
          <Square className="w-4 h-4 fill-current" /> Stop Recording
        </button>
      ) : (
        <button 
          onClick={startRecording}
          className="w-full p-2 bg-slate-800 text-slate-300 hover:text-white rounded border border-slate-700 text-sm font-bold flex items-center justify-center gap-2 transition-colors"
        >
          <Video className="w-4 h-4" /> Record WebM
        </button>
      )}
    </div>
  );
}
interface TruthTableAnalyzerProps {
  nodes: Node[];
  edges: Edge[];
  onClose: () => void;
  onSynthesize?: (table: { inputs: number[], outputs: number[] }[]) => void;
}
function TruthTableAnalyzer({ nodes, edges, onClose, onSynthesize }: TruthTableAnalyzerProps) {
  const inputNodes = useMemo(() => {
    return nodes.filter(n => n.type === 'inputNode').sort((a, b) => a.position.y - b.position.y);
  }, [nodes]);
  const outputNodes = useMemo(() => {
    return nodes.filter(n => n.type === 'outputNode').sort((a, b) => a.position.y - b.position.y);
  }, [nodes]);
  const truthTable = useMemo(() => {
    if (inputNodes.length === 0 || outputNodes.length === 0) return null;
    if (inputNodes.length > 6) return 'TOO_MANY_INPUTS';
    const n = inputNodes.length;
    const table = [];
    for (let i = 0; i < (1 << n); i++) {
      const inputs = [];
      for (let j = n - 1; j >= 0; j--) {
        inputs.push((i >> j) & 1);
      }
      const outputs = simulateCircuitMulti(nodes, edges, inputs);
      table.push({ inputs, outputs });
    }
    return table;
  }, [nodes, edges, inputNodes, outputNodes]);
  return (
    <motion.div
    initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="absolute top-20 right-6 w-96 max-h-[70vh] bg-slate-900/95 backdrop-blur-md border-2 border-slate-700 rounded-xl shadow-2xl flex flex-col z-50 overflow-hidden"
    >
      <div className="flex items-center justify-between p-4 border-b-2 border-slate-800 bg-slate-900">
        <div className="flex items-center gap-2 text-neon-blue">
          <Table className="w-5 h-5" />
          <h2 className="font-bold tracking-wider">TRUTH TABLE</h2>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="p-4 overflow-y-auto custom-scrollbar">
        {inputNodes.length === 0 ? (
          <p className="text-slate-400 text-center text-sm py-8">Add input nodes to see the truth table.</p>
        ) : outputNodes.length === 0 ? (
          <p className="text-slate-400 text-center text-sm py-8">Add output nodes to see the truth table.</p>
        ) : truthTable === 'TOO_MANY_INPUTS' ? (
          <p className="text-red-400 text-center text-sm py-8">Too many inputs. Maximum 6 inputs allowed to prevent freezing.</p>
        ) : truthTable && truthTable.length > 0 ? (
          <table className="w-full text-center border-collapse">
            <thead>
              <tr className="border-b-2 border-slate-700">
                {inputNodes.map((_, i) => (
                  <th key={`in-${i}`} className="py-2 px-1 text-xs text-slate-400 font-bold uppercase tracking-widest border-r border-slate-800">
                    IN {i + 1}
                  </th>
                ))}
                {outputNodes.map((_, i) => (
                  <th key={`out-${i}`} className="py-2 px-1 text-xs text-neon-green font-bold uppercase tracking-widest">
                    OUT {i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {truthTable.map((row, rowIdx) => (
                <tr key={rowIdx} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                  {row.inputs.map((val, colIdx) => (
                    <td key={`val-in-${colIdx}`} className="py-2 px-1 text-sm text-slate-300 font-mono border-r border-slate-800">
                      {val}
                    </td>
                  ))}
                  {row.outputs.map((val, colIdx) => (
                    <td 
                      key={`val-out-${colIdx}`} 
                      className={`py-2 px-1 text-sm font-mono font-bold ${val === 1 ? 'text-neon-green' : 'text-slate-500'}`}
                    >
                      {val}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
      {onSynthesize && truthTable && truthTable !== 'TOO_MANY_INPUTS' && outputNodes.length > 0 && (
         <div className="p-4 border-t-2 border-slate-800 bg-slate-900">
           <button 
             onClick={() => onSynthesize(truthTable as any)}
             className="w-full py-2 bg-neon-blue text-black font-bold rounded hover:bg-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.3)]"
           >
             Synthesize Minimal Circuit
           </button>
           <p className="text-[10px] text-slate-500 text-center mt-2">Replaces current canvas with a Sum-of-Products diagram</p>
         </div>
      )}
    </motion.div>
  );
}
interface Project {
  name: string;
  data: string; 
  updatedAt: number;
}
interface ProjectManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
  onLoad: (data: string) => void;
}
function ProjectManager({ isOpen, onClose, onSave, onLoad }: ProjectManagerProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [newProjectName, setNewProjectName] = useState('');
  useEffect(() => {
    if (isOpen) {
      loadProjectsList();
    }
  }, [isOpen]);
  const loadProjectsList = () => {
    try {
      const raw = localStorage.getItem('play_with_gates_projects');
      if (raw) {
        setProjects(JSON.parse(raw));
      }
    } catch (e) {
      console.error(e);
    }
  };
  const handleSaveNew = () => {
    if (!newProjectName.trim()) return;
    onSave(newProjectName.trim());
    setNewProjectName('');
    setTimeout(loadProjectsList, 100);
  };
  const handleDelete = (name: string) => {
    if (confirm(`Are you sure you want to delete project "${name}"?`)) {
      const updated = projects.filter(p => p.name !== name);
      localStorage.setItem('play_with_gates_projects', JSON.stringify(updated));
      setProjects(updated);
    }
  };
  if (!isOpen) return null;
  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          className="bg-slate-900 border-2 border-slate-700 rounded-2xl shadow-2xl w-full max-w-xl flex flex-col overflow-hidden"
        >
          <div className="p-4 border-b-2 border-slate-800 flex justify-between items-center bg-slate-950">
            <h2 className="text-xl font-bold text-slate-200 flex items-center gap-2">
              <FolderOpen className="text-neon-blue" /> Workspace Manager
            </h2>
            <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="p-6 flex flex-col gap-6">
            <div className="flex gap-2">
              <input 
                type="text" 
                placeholder="New Project Name..." 
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveNew()}
                className="flex-1 bg-slate-800 border border-slate-600 rounded p-2 text-white outline-none focus:border-neon-blue"
              />
              <button 
                onClick={handleSaveNew}
                className="bg-neon-blue/20 text-neon-blue border border-neon-blue/50 px-4 py-2 rounded font-bold hover:bg-neon-blue hover:text-black transition-colors flex items-center gap-2"
              >
                <Save className="w-4 h-4" /> Save Current
              </button>
            </div>
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto custom-scrollbar">
              {projects.length === 0 && (
                 <p className="text-slate-500 text-center py-4">No saved projects found.</p>
              )}
              {projects.sort((a, b) => b.updatedAt - a.updatedAt).map(p => (
                 <div key={p.name} className="flex items-center justify-between bg-slate-800 p-3 rounded border border-slate-700">
                    <div className="flex flex-col">
                       <span className="font-bold text-slate-200">{p.name}</span>
                       <span className="text-xs text-slate-500">{new Date(p.updatedAt).toLocaleString()}</span>
                    </div>
                     <div className="flex gap-2">
                       <button 
                         onClick={() => { onLoad(p.data); onClose(); }}
                         className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm transition-colors"
                       >
                         Load
                       </button>
                       <button 
                         onClick={() => handleDelete(p.name)}
                         className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                       >
                         <Trash2 className="w-5 h-5" />
                       </button>
                    </div>
                 </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
interface Circuit3DViewerProps {
  nodes: Node[];
  edges: Edge[];
}
function Circuit3DViewer({ nodes, edges }: Circuit3DViewerProps) {
  const scale = 0.05;
  const getPos = (n: Node) => {
     return [(n.position.x * scale) - 10, 0, (n.position.y * scale) - 10] as [number, number, number];
  };
  const lines = useMemo(() => {
    return edges.map(edge => {
      const sourceNode = nodes.find(n => n.id === edge.source);
      const targetNode = nodes.find(n => n.id === edge.target);
      if (!sourceNode || !targetNode) return null;
      const p1 = getPos(sourceNode);
      const p2 = getPos(targetNode);
      const isHigh = edge.animated; 
      const val = sourceNode.data.output || sourceNode.data.value; 
      const color = isHigh || val === 1 ? '#22d3ee' : '#334155'; 
      return { id: edge.id, p1, p2, color };
    }).filter(Boolean);
  }, [edges, nodes]);
  return (
    <div className="absolute inset-0 z-40 bg-slate-950">
      <Canvas camera={{ position: [0, 20, 20], fov: 45 }}>
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} intensity={1.5} color="#3b82f6" />
        <pointLight position={[-10, 10, -10]} intensity={1} color="#e879f9" />
        <Box args={[40, 0.5, 40]} position={[0, -0.5, 0]}>
          <meshStandardMaterial color="#0f172a" roughness={0.8} />
        </Box>
        {nodes.map(node => {
          const pos = getPos(node);
          const isHigh = node.data.output === 1 || node.data.value === 1;
          const chipColor = isHigh ? '#3b82f6' : '#1e293b';
          return (
            <group key={node.id} position={pos}>
              <Box args={[2, 0.5, 1]}>
                <meshStandardMaterial color={chipColor} roughness={0.5} metalness={0.8} />
              </Box>
              <Text 
                position={[0, 0.3, 0]} 
                rotation={[-Math.PI / 2, 0, 0]} 
                fontSize={0.2} 
                color="#cbd5e1"
              >
                {node.type?.replace('Node', '').toUpperCase()}
              </Text>
            </group>
          );
        })}
        {lines.map((line: any) => (
          <DreiLine 
             key={line.id} 
             points={[line.p1, [line.p1[0], 0.1, line.p2[2]], line.p2]} 
             color={line.color} 
             lineWidth={3} 
              position={[0, 0.1, 0]} 
          />
        ))}
        <Environment preset="city" />
        <OrbitControls makeDefault autoRotate autoRotateSpeed={0.5} maxPolarAngle={Math.PI / 2.1} />
      </Canvas>
    </div>
  );
}
const nodeTypes: NodeTypes = {
  inputNode: InputNode,
  gateNode: GateNode,
  outputNode: OutputNode,
  clockNode: ClockNode,
  dffNode: DFFNode,
  delayNode: DelayNode,
  busMergerNode: BusMergerNode,
  busSplitterNode: BusSplitterNode,
  aluNode: ALUNode,
  memoryNode: MemoryNode,
  codeNode: CodeNode,
  oscilloscopeNode: OscilloscopeNode,
  macroNode: MacroNode,
  segmentDisplayNode: SegmentDisplayNode,
  synthNode: SynthNode,
};
const edgeTypes = {
  default: GlowingEdge,
  busEdge: BusEdge,
};
let id = 0;
const getId = () => `node_${id++}`;
function CircuitCanvas({ 
  nodes: controlledNodes, 
  edges: controlledEdges, 
  onNodesChange: controlledOnNodesChange, 
  onEdgesChange: controlledOnEdgesChange,
  setNodes: controlledSetNodes,
  setEdges: controlledSetEdges,
  allowedGates = GATE_TYPES
  }: any = {}) {
  const [localNodes, setLocalNodes, onLocalNodesChange] = useNodesState([]);
  const [localEdges, setLocalEdges, onLocalEdgesChange] = useEdgesState([]);
  const isControlled = !!controlledNodes;
  const nodes = isControlled ? controlledNodes : localNodes;
  const setNodes = isControlled ? controlledSetNodes : setLocalNodes;
  const onNodesChange = isControlled ? controlledOnNodesChange : onLocalNodesChange;
  const edges = isControlled ? controlledEdges : localEdges;
  const setEdges = isControlled ? controlledSetEdges : setLocalEdges;
  const onEdgesChange = isControlled ? controlledOnEdgesChange : onLocalEdgesChange;
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [macros, setMacros] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem('play_with_gates_macros') || '[]'); } catch { return []; }
  });
  const [expression, setExpression] = useState('');
  const [verilogCode, setVerilogCode] = useState<string | null>(null);
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [showTruthTable, setShowTruthTable] = useState(false);
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [show3D, setShow3D] = useState(false);
  const [clockRunning, setClockRunning] = useState(true);
  const [clockFreq, setClockFreq] = useState(1);
  const onSelectionChange = useCallback(({ nodes }: { nodes: Node[] }) => {
    setSelectedNodes(nodes.map(n => n.id));
  }, []);
  const handleDeleteSelected = useCallback(() => {
    setNodes(nds => nds.filter(n => !selectedNodes.includes(n.id)));
    setEdges(eds => eds.filter(e => !selectedNodes.includes(e.source) && !selectedNodes.includes(e.target)));
    setSelectedNodes([]);
  }, [selectedNodes, setNodes, setEdges]);
  const handleExportVerilog = () => {
     try {
       const code = exportToVerilog(nodes, edges);
       setVerilogCode(code);
     } catch (e: any) {
       alert("Failed to export Verilog: " + e.message);
     }
  };
  const handleBuildExpression = () => {
     try {
      if (!expression.trim()) return;
      const { nodes: newNodes, edges: newEdges } = buildCircuitFromExpression(expression);
      const boundNodes = newNodes.map((n: any) => 
        n.type === 'inputNode' ? { ...n, data: { ...n.data, onToggle: onToggleInput } } : n
      );
      setNodes(boundNodes);
      setEdges(newEdges);
    } catch (e: any) {
      alert("Failed to parse expression: " + e.message);
    }
  };
  useEffect(() => {
    if (isControlled) return; 
    const hash = window.location.hash;
    if (hash && hash.startsWith('#circuit=')) {
      try {
        const dataStr = atob(hash.replace('#circuit=', ''));
        const data = JSON.parse(dataStr);
        if (data.nodes && data.edges) {
          setNodes(data.nodes.map((n: any) => 
            (n.type === 'inputNode' || n.type === 'clockNode') 
              ? { ...n, data: { ...n.data, onToggle: onToggleInput } } 
              : n
          ));
          setEdges(data.edges);
        }
      } catch (e) {
        console.error("Failed to load circuit from URL");
      }
    }
  }, [isControlled, setNodes, setEdges]);
  const handleClear = () => {
    if (confirm('Are you sure you want to clear the canvas?')) {
      setNodes([]);
      setEdges([]);
    }
  };
  const handleSaveProject = (name: string) => {
    try {
      const data = { nodes, edges };
      const dataStr = btoa(JSON.stringify(data));
      const raw = localStorage.getItem('play_with_gates_projects');
      let projects = [];
      if (raw) projects = JSON.parse(raw);
      const existing = projects.findIndex((p: any) => p.name === name);
      if (existing >= 0) {
        projects[existing].data = dataStr;
        projects[existing].updatedAt = Date.now();
      } else {
        projects.push({ name, data: dataStr, updatedAt: Date.now() });
      }
      localStorage.setItem('play_with_gates_projects', JSON.stringify(projects));
    } catch (e) {
      alert('Failed to save project.');
    }
  };
  const handleLoadProject = (dataStr: string) => {
    try {
      const data = JSON.parse(atob(dataStr));
      if (data.nodes && data.edges) {
        setNodes(data.nodes.map((n: any) => 
          (n.type === 'inputNode' || n.type === 'clockNode') 
            ? { ...n, data: { ...n.data, onToggle: onToggleInput } } 
            : n
        ));
        setEdges(data.edges);
      }
    } catch (e) {
      alert('Failed to load project.');
    }
  };
  const handleShare = () => {
    try {
      const data = { nodes, edges };
      const dataStr = btoa(JSON.stringify(data));
      window.location.hash = `circuit=${dataStr}`;
      navigator.clipboard.writeText(window.location.href);
      alert('Shareable link copied to clipboard!');
    } catch (e) {
      alert('Failed to generate share link.');
       }
  };
  const onToggleInput = useCallback((nodeId: string, val: number) => {
    setNodes((nds) => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, value: val } } : n));
  }, [setNodes]);
  const handleTidyLayout = useCallback(() => {
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      nodes,
      edges
    );
    setNodes([...layoutedNodes]);
    setEdges([...layoutedEdges]);
  }, [nodes, edges, setNodes, setEdges]);
  const handleCreateMacro = () => {
    const name = prompt("Enter a name for your custom Macro gate:");
    if (!name) return;
    const numInputs = nodes.filter(n => n.type === 'inputNode').length;
    const numOutputs = nodes.filter(n => n.type === 'outputNode').length;
    if (numInputs === 0 || numOutputs === 0) {
       alert("A macro must have at least one Input and one Output node!");
       return;
    }
    const newMacro = {
       id: `macro_${Date.now()}`,
       name,
       nodes,
       edges,
       numInputs,
       numOutputs
    };
    const updatedMacros = [...macros, newMacro];
    setMacros(updatedMacros);
    localStorage.setItem('play_with_gates_macros', JSON.stringify(updatedMacros));
  };
  const onConnect = useCallback((params: Connection) => {
    const isBus = params.sourceHandle === 'bus-out' || params.targetHandle === 'bus-in';
    const edgeType = isBus ? 'busEdge' : 'default';
    const newEdge = { ...params, id: `e-${params.source}-${params.target}-${Date.now()}`, type: edgeType };
    setEdges((eds) => addEdge(newEdge, eds));
    }, [setEdges]);
  const handleSynthesize = async (truthTable: { inputs: number[], outputs: number[] }[]) => {
    const numInputs = truthTable[0].inputs.length;
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];
    let idCounter = 1000;
    const getSynthId = (prefix: string) => `${prefix}-${idCounter++}`;
    const inputIds: string[] = [];
    for (let i = 0; i < numInputs; i++) {
      const id = getSynthId('in');
      inputIds.push(id);
      newNodes.push({ id, type: 'inputNode', position: { x: 0, y: 0 }, data: { id, value: 0, onToggle: onToggleInput }, deletable: true });
    }
    const minterms = truthTable.filter(r => r.outputs[0] === 1);
    if (minterms.length === 0) {
      alert("No TRUE outputs to synthesize! (Circuit is always 0)");
      return;
    }
    const productOutputs: string[] = [];
    for (const row of minterms) {
       const termInputs: string[] = [];
       for (let i = 0; i < numInputs; i++) {
          if (row.inputs[i] === 0) {
             const notId = getSynthId('not');
             newNodes.push({ id: notId, type: 'gateNode', position: { x: 0, y: 0 }, data: { type: 'NOT', output: 0 } });
             newEdges.push({ id: getSynthId('e'), source: inputIds[i], target: notId, targetHandle: 'a', type: 'default' });
             termInputs.push(notId);
          } else {
             termInputs.push(inputIds[i]);
          }
       }
       let currentAndOut = termInputs[0];
       for (let i = 1; i < termInputs.length; i++) {
          const andId = getSynthId('and');
          newNodes.push({ id: andId, type: 'gateNode', position: { x: 0, y: 0 }, data: { type: 'AND', output: 0 } });
          newEdges.push({ id: getSynthId('e'), source: currentAndOut, target: andId, targetHandle: 'a', type: 'default' });
          newEdges.push({ id: getSynthId('e'), source: termInputs[i], target: andId, targetHandle: 'b', type: 'default' });
          currentAndOut = andId;
       }
       productOutputs.push(currentAndOut);
        }
    let finalOut = productOutputs[0];
    for (let i = 1; i < productOutputs.length; i++) {
       const orId = getSynthId('or');
       newNodes.push({ id: orId, type: 'gateNode', position: { x: 0, y: 0 }, data: { type: 'OR', output: 0 } });
       newEdges.push({ id: getSynthId('e'), source: finalOut, target: orId, targetHandle: 'a', type: 'default' });
       newEdges.push({ id: getSynthId('e'), source: productOutputs[i], target: orId, targetHandle: 'b', type: 'default' });
       finalOut = orId;
    }
    const outId = getSynthId('out');
    newNodes.push({ id: outId, type: 'outputNode', position: { x: 0, y: 0 }, data: { id: outId, value: 0 }, deletable: true });
    newEdges.push({ id: getSynthId('e'), source: finalOut, target: outId, targetHandle: 'in', type: 'default' });
    const { nodes: layoutedNodes, edges: layoutedEdges } = await getLayoutedElements(newNodes, newEdges);
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
    setShowTruthTable(false);
  };
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (!reactFlowWrapper.current) return;
      const type = event.dataTransfer.getData('application/reactflow');
      const gateType = event.dataTransfer.getData('application/gatetype') as GateType;
      if (!type) return;
      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      };
      let newData = {};
      if (type === 'inputNode') {
        newData = { value: 0, onToggle: onToggleInput };
      } else if (type === 'gateNode') {
        newData = { type: gateType, output: 0 };
      } else if (type === 'outputNode') {
        newData = { value: 0 };
        } else if (type === 'clockNode') {
        newData = { value: 0, onToggle: onToggleInput };
      } else if (type === 'dffNode') {
        newData = { output: 0, prevClk: 0 };
      } else if (type === 'macroNode') {
         const macroStr = event.dataTransfer.getData('application/macro');
         if (macroStr) {
            const macroDef = JSON.parse(macroStr);
            newData = { name: macroDef.name, numInputs: macroDef.numInputs, numOutputs: macroDef.numOutputs, macroDef, outputVals: Array(macroDef.numOutputs).fill(0) };
         }
      } else if (type === 'segmentDisplayNode') {
         newData = { inputVals: [0, 0, 0, 0] };
      } else if (type === 'synthNode') {
         const freq = event.dataTransfer.getData('application/freq') || '440';
         newData = { value: 0, freq: parseInt(freq) };
      } else if (type === 'delayNode') {
         newData = { value: 0, inVal: 0 };
      } else if (type === 'busMergerNode') {
         newData = { inputVals: [0,0,0,0], busValue: 0, output: 0 };
      } else if (type === 'busSplitterNode') {
         newData = { busValue: 0, output: 0 };
      } else if (type === 'aluNode') {
         newData = { busA: 0, busB: 0, op0: 0, op1: 0, out: 0, carry: 0, output: 0 };
      } else if (type === 'memoryNode') {
         newData = { addr: 0, dataIn: 0, we: 0, dataOut: 0, memory: Array(16).fill(0), output: 0 };
      } else if (type === 'codeNode') {
         newData = { code: 'return (A & B) | C;', output: 0 };
      } else if (type === 'oscilloscopeNode') {
         newData = { history: [] };
      }
      const newId = getId();
      const newNode = {
        id: newId,
        type,
        position,
        data: { id: newId, ...newData },
      };
      setNodes((nds) => nds.concat(newNode));
    },
    [setNodes, onToggleInput]
    );
  useEffect(() => {
    let changed = false;
    let currentNodes = [...nodes];
    let settling = true;
    let iterations = 0;
    while (settling && iterations < 50) {
      settling = false;
      iterations++;
      currentNodes = currentNodes.map(node => {
        if (node.type === 'inputNode' || node.type === 'clockNode') return node;
        const incomingEdges = edges.filter(e => e.target === node.id);
        const getVal = (sourceNode: any, edge: any) => {
          if (!sourceNode) return 0;
          if (sourceNode.type === 'dffNode') {
             return edge?.sourceHandle === 'qbar' ? (sourceNode.data.output === 0 ? 1 : 0) : sourceNode.data.output;
          }
          if (sourceNode.type === 'macroNode' && edge?.sourceHandle) {
             const outIdx = parseInt(edge.sourceHandle.replace('out-', ''));
             return sourceNode.data.outputVals?.[outIdx] || 0;
          }
          if (sourceNode.type === 'busSplitterNode' && edge?.sourceHandle) {
             const outIdx = parseInt(edge.sourceHandle.replace('out-', ''));
             const busVal = sourceNode.data.output || 0;
             return (busVal >> outIdx) & 1;
          }
          if (sourceNode.type === 'aluNode') {
             return edge?.sourceHandle === 'carry-out' ? (sourceNode.data.carry || 0) : (sourceNode.data.out || 0);
          }
          return sourceNode.data.output ?? sourceNode.data.value ?? 0;
        };
        if (node.type === 'gateNode') {
          const valAEdge = incomingEdges.find(e => e.targetHandle === 'a');
          const valBEdge = incomingEdges.find(e => e.targetHandle === 'b');
          const sourceANode = currentNodes.find(n => n.id === valAEdge?.source);
          const sourceBNode = currentNodes.find(n => n.id === valBEdge?.source);
          const valA = getVal(sourceANode, valAEdge);
          const valB = getVal(sourceBNode, valBEdge);
          const newOutput = evaluateGate(node.data.type, [valA as number, valB as number]);
          if (newOutput !== node.data.output) {
            settling = true;
            changed = true;
            return { ...node, data: { ...node.data, output: newOutput } };
          }
        }
        if (node.type === 'dffNode') {
          const valDEdge = incomingEdges.find(e => e.targetHandle === 'd');
          const valClkEdge = incomingEdges.find(e => e.targetHandle === 'clk');
          const sourceDNode = currentNodes.find(n => n.id === valDEdge?.source);
          const sourceClkNode = currentNodes.find(n => n.id === valClkEdge?.source);
          const valD = getVal(sourceDNode, valDEdge);
          const valClk = getVal(sourceClkNode, valClkEdge);
          let newState = node.data.output;
          const newPrevClk = valClk;
          if (valClk === 1 && node.data.prevClk === 0) {
             newState = valD;
          }
          if (newState !== node.data.output || newPrevClk !== node.data.prevClk) {
             settling = true;
             changed = true;
             return { ...node, data: { ...node.data, output: newState, prevClk: newPrevClk } };
          }
        }
        if (node.type === 'macroNode') {
           const macroDef = node.data.macroDef;
           const inputs = [];
           for (let i = 0; i < macroDef.numInputs; i++) {
              const edge = incomingEdges.find(e => e.targetHandle === `in-${i}`);
              const sourceNode = currentNodes.find(n => n.id === edge?.source);
              inputs.push(getVal(sourceNode, edge));
           }
           const outVals = simulateCircuitMulti(macroDef.nodes, macroDef.edges, inputs);
           let changedMacro = false;
           const oldOutVals = node.data.outputVals || [];
           if (outVals.length !== oldOutVals.length || outVals.some((v, i) => v !== oldOutVals[i])) {
              changedMacro = true;
           }
           if (changedMacro) {
              settling = true;
              changed = true;
              return { ...node, data: { ...node.data, outputVals: outVals } };
           }
        }
        if (node.type === 'busMergerNode') {
           const inputs = [];
           for (let i = 0; i < 4; i++) {
              const edge = incomingEdges.find(e => e.targetHandle === `in-${i}`);
              const sourceNode = currentNodes.find(n => n.id === edge?.source);
              inputs.push(getVal(sourceNode, edge));
           }
           const busValue = (inputs[3] << 3) | (inputs[2] << 2) | (inputs[1] << 1) | inputs[0];
           if (busValue !== node.data.busValue || inputs.some((v,i) => v !== (node.data.inputVals?.[i]))) {
              settling = true;
              changed = true;
              return { ...node, data: { ...node.data, busValue, inputVals: inputs, output: busValue } };
           }
        }
        if (node.type === 'busSplitterNode') {
          const valEdge = incomingEdges.find(e => e.targetHandle === 'bus-in');
          const sourceNode = currentNodes.find(n => n.id === valEdge?.source);
          const busValue = getVal(sourceNode, valEdge);
          if (busValue !== node.data.busValue) {
             settling = true;
             changed = true;
             return { ...node, data: { ...node.data, busValue, output: busValue } };
          }
        }
        if (node.type === 'aluNode') {
          const busAEdge = incomingEdges.find(e => e.targetHandle === 'bus-a');
          const busBEdge = incomingEdges.find(e => e.targetHandle === 'bus-b');
          const op0Edge = incomingEdges.find(e => e.targetHandle === 'op-0');
          const op1Edge = incomingEdges.find(e => e.targetHandle === 'op-1');
          const busA = getVal(currentNodes.find(n => n.id === busAEdge?.source), busAEdge);
          const busB = getVal(currentNodes.find(n => n.id === busBEdge?.source), busBEdge);
          const op0 = getVal(currentNodes.find(n => n.id === op0Edge?.source), op0Edge);
          const op1 = getVal(currentNodes.find(n => n.id === op1Edge?.source), op1Edge);
          const opCode = (op1 << 1) | op0;
          let out = 0;
          let carry = 0;
          if (opCode === 0) {
            const sum = busA + busB;
            out = sum & 0xF;
            carry = (sum > 0xF) ? 1 : 0;
          } else if (opCode === 1) {
            out = Math.max(0, busA - busB) & 0xF;
          } else if (opCode === 2) {
            out = busA & busB;
          } else if (opCode === 3) {
            out = busA | busB;
          }
          if (out !== node.data.out || carry !== node.data.carry || busA !== node.data.busA || busB !== node.data.busB || op0 !== node.data.op0 || op1 !== node.data.op1) {
             settling = true; changed = true;
             return { ...node, data: { busA, busB, op0, op1, out, carry, output: out } };
          }
        }
        if (node.type === 'memoryNode') {
          const addrEdge = incomingEdges.find(e => e.targetHandle === 'bus-addr');
          const dataEdge = incomingEdges.find(e => e.targetHandle === 'bus-data');
          const weEdge = incomingEdges.find(e => e.targetHandle === 'we');
          const addr = getVal(currentNodes.find(n => n.id === addrEdge?.source), addrEdge);
          const dataIn = getVal(currentNodes.find(n => n.id === dataEdge?.source), dataEdge);
          const we = getVal(currentNodes.find(n => n.id === weEdge?.source), weEdge);
          let memory = node.data.memory || Array(16).fill(0);
          if (we === 1 && memory[addr] !== dataIn) {
            memory = [...memory];
            memory[addr] = dataIn;
          }
          const dataOut = memory[addr];
          if (addr !== node.data.addr || dataIn !== node.data.dataIn || we !== node.data.we || dataOut !== node.data.dataOut || memory !== node.data.memory) {
             settling = true; changed = true;
             return { ...node, data: { addr, dataIn, we, dataOut, memory, output: dataOut } };
          }
        }
        if (node.type === 'codeNode') {
          const aEdge = incomingEdges.find(e => e.targetHandle === 'in-a');
          const bEdge = incomingEdges.find(e => e.targetHandle === 'in-b');
          const cEdge = incomingEdges.find(e => e.targetHandle === 'in-c');
          const dEdge = incomingEdges.find(e => e.targetHandle === 'in-d');
          const a = getVal(currentNodes.find(n => n.id === aEdge?.source), aEdge);
          const b = getVal(currentNodes.find(n => n.id === bEdge?.source), bEdge);
          const c = getVal(currentNodes.find(n => n.id === cEdge?.source), cEdge);
          const d = getVal(currentNodes.find(n => n.id === dEdge?.source), dEdge);
          let out = 0;
          let error = undefined;
          try {
             const fn = new Function('A', 'B', 'C', 'D', node.data.code || 'return 0;');
             out = fn(a, b, c, d) || 0;
          } catch (e: any) {
             error = e.message;
          }
          if (out !== node.data.output || error !== node.data.error || node.data.a !== a || node.data.b !== b || node.data.c !== c || node.data.d !== d) {
             settling = true; changed = true;
             return { ...node, data: { ...node.data, output: out, error, a, b, c, d } };
          }
        }
        if (node.type === 'oscilloscopeNode') {
          const ch1Edge = incomingEdges.find(e => e.targetHandle === 'ch-1');
          const ch2Edge = incomingEdges.find(e => e.targetHandle === 'ch-2');
          const ch3Edge = incomingEdges.find(e => e.targetHandle === 'ch-3');
          const ch4Edge = incomingEdges.find(e => e.targetHandle === 'ch-4');
          const ch1 = getVal(currentNodes.find(n => n.id === ch1Edge?.source), ch1Edge);
          const ch2 = getVal(currentNodes.find(n => n.id === ch2Edge?.source), ch2Edge);
          const ch3 = getVal(currentNodes.find(n => n.id === ch3Edge?.source), ch3Edge);
          const ch4 = getVal(currentNodes.find(n => n.id === ch4Edge?.source), ch4Edge);
          const history = node.data.history || [];
          const now = Date.now();
          const lastPoint = history[history.length - 1];
          const changedVals = !lastPoint || lastPoint.ch1 !== ch1 || lastPoint.ch2 !== ch2 || lastPoint.ch3 !== ch3 || lastPoint.ch4 !== ch4;
          if (changedVals || (history.length > 0 && now - lastPoint.time > 100)) {
             const newHistory = [...history, { time: now, ch1, ch2, ch3, ch4 }];
             if (newHistory.length > 50) newHistory.shift();
             changed = true;
             return { ...node, data: { ...node.data, history: newHistory } };
          }
        }
        if (node.type === 'delayNode') {
          const valEdge = incomingEdges[0];
          const sourceNode = currentNodes.find(n => n.id === valEdge?.source);
          const val = getVal(sourceNode, valEdge);
          if (val !== node.data.inVal) {