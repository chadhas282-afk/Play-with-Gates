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
            settling = true;
            changed = true;
            return { ...node, data: { ...node.data, inVal: val } };
          }
        }
        if (node.type === 'outputNode' || node.type === 'synthNode') {
          const valEdge = incomingEdges[0];
          const sourceNode = currentNodes.find(n => n.id === valEdge?.source);
          const val = getVal(sourceNode, valEdge);
          if (val !== node.data.value) {
            settling = true;
            changed = true;
            return { ...node, data: { ...node.data, value: val } };
          }
        }
        if (node.type === 'segmentDisplayNode') {
           const inputs = [];
           for (let i = 0; i < 4; i++) {
              const edge = incomingEdges.find(e => e.targetHandle === `in-${i}`);
              const sourceNode = currentNodes.find(n => n.id === edge?.source);
              inputs.push(getVal(sourceNode, edge));
           }
           let changedSeg = false;
           const oldInputs = node.data.inputVals || [0,0,0,0];
           if (inputs.some((v, i) => v !== oldInputs[i])) {
              changedSeg = true;
           }
           if (changedSeg) {
              settling = true;
              changed = true;
              return { ...node, data: { ...node.data, inputVals: inputs } };
           }
        }
        return node;
    });
  }
  currentNodes = currentNodes.map(node => {
     if (node.data.isMonitored) {
         let val = 0;
         if (node.type === 'outputNode' || node.type === 'inputNode' || node.type === 'clockNode') {
          val = node.data.value ?? 0;
         } else {
            val = node.data.output ?? 0;
         }
         const history = [...(node.data.history || []), val].slice(-50);
         return { ...node, data: { ...node.data, history } };
     }
     return node;
  });
  if (changed) {
      setNodes(currentNodes);
    }
    let edgesChanged = false;
    const currentEdges = edges.map(edge => {
      const sourceNode = currentNodes.find(n => n.id === edge.source);
      const getVal = (sNode: any, edg: any) => {
          if (!sNode) return 0;
          if (sNode.type === 'dffNode') {
             return edg?.sourceHandle === 'qbar' ? (sNode.data.output === 0 ? 1 : 0) : sNode.data.output;
          }
          if (sNode.type === 'macroNode') {
             const outIndex = parseInt(edg?.sourceHandle?.replace('out-', '') || '0');
             return sNode.data.outputVals?.[outIndex] ?? 0;
          }
          return sNode.data.output ?? sNode.data.value ?? 0;
      };
      const val = getVal(sourceNode, edge);
      const isHigh = val === 1;
      const isCurrentlyAnimated = edge.animated;
      if (isHigh !== isCurrentlyAnimated) {
        edgesChanged = true;
        return {
          ...edge,
          animated: isHigh,
          style: { 
            stroke: isHigh ? '#22c55e' : '#475569', 
            strokeWidth: 4,
            filter: isHigh ? 'drop-shadow(0 0 5px rgba(34,197,94,0.8))' : 'none'
          }
        };
        }
      return edge;
    });
    if (edgesChanged || changed) {
      setEdges((eds) => eds.map(e => {
         const current = currentEdges.find(ce => ce.id === e.id);
         return current ? current : e;
      }));
    }
  }, [nodes, edges, setNodes, setEdges]);
  const onDragStart = (event: React.DragEvent, nodeType: string, gateType?: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    if (gateType) event.dataTransfer.setData('application/gatetype', gateType);
    event.dataTransfer.effectAllowed = 'move';
  };
  return (
    <div className="flex w-full h-full bg-slate-950 font-sans relative overflow-hidden">
      <TutorialOverlay run={showTutorial} onFinish={() => setShowTutorial(false)} />
      <motion.div 
        initial={{ x: -50, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="w-64 bg-slate-900 border-r border-slate-700 p-4 flex flex-col gap-6 overflow-y-auto z-10 shadow-xl custom-scrollbar"
        id="tour-sidebar"
      >
        <h2 className="text-xl font-bold text-slate-200">Components</h2>
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">I/O Nodes</h3>
          <motion.div 
            whileHover={{ scale: 1.05, borderColor: '#3b82f6' }}
            whileTap={{ scale: 0.95 }}
            className="p-3 border-2 border-slate-700 rounded-lg bg-slate-800 cursor-grab transition-colors text-center font-bold"
            onDragStart={(e: any) => onDragStart(e, 'inputNode')}
            draggable
          >
            Input Toggle
          </motion.div>
          <motion.div 
            whileHover={{ scale: 1.05, borderColor: '#3b82f6' }}
            whileTap={{ scale: 0.95 }}
            className="p-3 border-2 border-slate-700 rounded-lg bg-slate-800 cursor-grab transition-colors text-center font-bold"
            onDragStart={(e: any) => onDragStart(e, 'clockNode')}
            draggable
          >
            Clock (Oscillator)
          </motion.div>
          <motion.div 
            whileHover={{ scale: 1.05, borderColor: '#eab308' }}
            whileTap={{ scale: 0.95 }}
            className="p-3 border-2 border-slate-700 rounded-lg bg-slate-800 cursor-grab transition-colors text-center font-bold"
            onDragStart={(e: any) => onDragStart(e, 'delayNode')}
            draggable
          >
            Delay (1 Tick)
          </motion.div>
          <motion.div 
            whileHover={{ scale: 1.05, borderColor: '#22c55e' }}
            whileTap={{ scale: 0.95 }}
            className="p-3 border-2 border-slate-700 rounded-lg bg-slate-800 cursor-grab transition-colors text-center font-bold"
            onDragStart={(e: any) => onDragStart(e, 'outputNode')}
            draggable
          >
            Output LED
          </motion.div>
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Routing & Buses</h3>
          <motion.div 
            whileHover={{ scale: 1.05, borderColor: '#6366f1' }}
            whileTap={{ scale: 0.95 }}
            className="p-3 border-2 border-slate-700 rounded-lg bg-slate-800 cursor-grab transition-colors text-center font-bold"
            onDragStart={(e: any) => onDragStart(e, 'busMergerNode')}
            draggable
          >
            Bus Merger (4-bit)
          </motion.div>
          <motion.div 
            whileHover={{ scale: 1.05, borderColor: '#6366f1' }}
            whileTap={{ scale: 0.95 }}
            className="p-3 border-2 border-slate-700 rounded-lg bg-slate-800 cursor-grab transition-colors text-center font-bold"
            onDragStart={(e: any) => onDragStart(e, 'busSplitterNode')}
            draggable
            >
            Bus Splitter (4-bit)
          </motion.div>
        </div>
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">A/V Nodes</h3>
          <motion.div 
            whileHover={{ scale: 1.05, borderColor: '#06b6d4' }}
            whileTap={{ scale: 0.95 }}
            className="p-3 border-2 border-slate-700 rounded-lg bg-slate-800 cursor-grab transition-colors text-center font-bold"
            onDragStart={(e: any) => onDragStart(e, 'oscilloscopeNode')}
            draggable
          >
            Oscilloscope (4-Ch)
          </motion.div>
          <motion.div 
            whileHover={{ scale: 1.05, borderColor: '#a855f7' }}
            whileTap={{ scale: 0.95 }}
            className="p-3 border-2 border-slate-700 rounded-lg bg-slate-800 cursor-grab transition-colors text-center font-bold"
            onDragStart={(e: any) => {
               onDragStart(e, 'synthNode');
               e.dataTransfer.setData('application/freq', '440');
            }}
            draggable
          >
            Synth (A4)
          </motion.div>
          <motion.div 
            whileHover={{ scale: 1.05, borderColor: '#a855f7' }}
            whileTap={{ scale: 0.95 }}
            className="p-3 border-2 border-slate-700 rounded-lg bg-slate-800 cursor-grab transition-colors text-center font-bold"
            onDragStart={(e: any) => {
               onDragStart(e, 'synthNode');
               e.dataTransfer.setData('application/freq', '659');
            }}
            draggable
          >
            Synth (E5)
          </motion.div>
          <motion.div 
          whileHover={{ scale: 1.05, borderColor: '#0ea5e9' }}
            whileTap={{ scale: 0.95 }}
            className="p-3 border-2 border-slate-700 rounded-lg bg-slate-800 cursor-grab transition-colors text-center font-bold"
            onDragStart={(e: any) => onDragStart(e, 'segmentDisplayNode')}
            draggable
          >
            7-Segment HEX
          </motion.div>
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">IC Library</h3>
          <motion.div 
            whileHover={{ scale: 1.05, borderColor: '#ef4444' }}
            whileTap={{ scale: 0.95 }}
            className="p-3 border-2 border-slate-700 rounded-lg bg-slate-800 cursor-grab transition-colors text-center font-bold"
            onDragStart={(e: any) => onDragStart(e, 'aluNode')}
            draggable
          >
            4-Bit ALU
          </motion.div>
          <motion.div 
            whileHover={{ scale: 1.05, borderColor: '#10b981' }}
            whileTap={{ scale: 0.95 }}
            className="p-3 border-2 border-slate-700 rounded-lg bg-slate-800 cursor-grab transition-colors text-center font-bold"
            onDragStart={(e: any) => onDragStart(e, 'memoryNode')}
            draggable
          >
            16B RAM
          </motion.div>
          <motion.div 
            whileHover={{ scale: 1.05, borderColor: '#d946ef' }}
            whileTap={{ scale: 0.95 }}
            className="p-3 border-2 border-slate-700 rounded-lg bg-slate-800 cursor-grab transition-colors text-center font-bold"
            onDragStart={(e: any) => onDragStart(e, 'codeNode')}
            draggable
          >
            JS Scripting Node
          </motion.div>
        </div>
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Logic Gates</h3>
          <motion.div 
          whileHover={{ scale: 1.05, borderColor: '#64748b' }}
            whileTap={{ scale: 0.95 }}
            className="p-3 border-2 border-slate-700 rounded-lg bg-slate-800 cursor-grab transition-colors text-center font-bold"
            onDragStart={(e: any) => onDragStart(e, 'dffNode')}
            draggable
          >
            D Flip-Flop
          </motion.div>
          {allowedGates.map((type: GateType) => (
            <motion.div 
              key={type}
              whileHover={{ scale: 1.05, borderColor: '#64748b' }}
              whileTap={{ scale: 0.95 }}
              className="p-3 border-2 border-slate-700 rounded-lg bg-slate-800 cursor-grab transition-colors text-center font-bold"
              onDragStart={(e: any) => onDragStart(e, 'gateNode', type)}
              draggable
            >
              {type} Gate
            </motion.div>
          ))}
        </div>
        <div className="space-y-3 mt-4">
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Custom Macros</h3>
          {macros.map(macro => (
            <motion.div 
              key={macro.id}
              whileHover={{ scale: 1.05, backgroundColor: 'rgba(59,130,246,0.2)' }}
              whileTap={{ scale: 0.95 }}
              className="p-3 border-2 border-neon-blue rounded-lg bg-slate-800 cursor-grab transition-colors text-center font-bold text-neon-blue"
              onDragStart={(e: any) => {
                 onDragStart(e, 'macroNode');
                 e.dataTransfer.setData('application/macro', JSON.stringify(macro));
              }}
              draggable
            >
              {macro.name}
            </motion.div>
          ))}
          <motion.button 
             whileHover={{ scale: 1.02 }}
             whileTap={{ scale: 0.98 }}
             onClick={handleCreateMacro} 
             className="w-full p-2 bg-slate-800 text-slate-300 rounded hover:bg-slate-700 transition border border-dashed border-slate-500 text-xs font-bold"
          >
            + Create Macro
          </motion.button>
        </div>
        <div className="space-y-3 mt-4">
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Auto-Builder</h3>
          <div className="flex gap-2">
            <input 
              type="text" 
              value={expression} 
              onChange={e => setExpression(e.target.value)} 
              placeholder="e.g. A * B + !C"
              className="flex-1 bg-slate-900 text-slate-200 p-2 rounded border border-slate-700 text-sm font-mono focus:border-neon-blue focus:outline-none w-0"
            />
            <motion.button 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleBuildExpression}
              className="p-2 bg-neon-blue text-black font-bold text-xs rounded shadow-[0_0_15px_rgba(59,130,246,0.4)]"
            >
              Build
            </motion.button>
          </div>
        </div>
        <div className="space-y-3 mt-4">
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Oscilloscope</h3>
          <div className="space-y-1 max-h-32 overflow-y-auto pr-2 custom-scrollbar">
             {nodes.map(n => (
                <div key={n.id} className="flex items-center justify-between">
                   <span className="text-xs text-slate-400 font-mono truncate mr-2" title={n.id}>
                      {n.type?.replace('Node', '')}_{n.id.replace('node_', '').replace('auto_', '')}
                   </span>
                   <button 
                     onClick={() => setNodes((nds: any) => nds.map((nd: any) => nd.id === n.id ? { ...nd, data: { ...nd.data, isMonitored: !nd.data.isMonitored } } : nd))}
                     className={cn("text-xs px-2 py-1 rounded font-bold transition", n.data.isMonitored ? "bg-neon-green text-black shadow-[0_0_10px_rgba(34,197,94,0.3)]" : "bg-slate-800 text-slate-500 hover:text-slate-300")}
                   >
                      {n.data.isMonitored ? "ON" : "OFF"}
                      </button>
                </div>
             ))}
             {nodes.length === 0 && <span className="text-xs text-slate-600">No nodes</span>}
          </div>
        </div>
        <div className="space-y-3 mt-auto pt-4 border-t border-slate-700" id="tour-actions">
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Canvas Actions</h3>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => setShow3D(!show3D)} className="w-full p-2 bg-emerald-900/40 text-emerald-400 rounded border border-emerald-500/50 text-sm font-bold flex items-center justify-center gap-2 shadow-[0_0_10px_rgba(16,185,129,0.1)]">Toggle 3D Motherboard</motion.button>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={handleTidyLayout} className="w-full p-2 bg-yellow-900/40 text-yellow-400 rounded border border-yellow-500/50 text-sm font-bold flex items-center justify-center gap-2 shadow-[0_0_10px_rgba(234,179,8,0.1)]">Tidy Layout</motion.button>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={handleCreateMacro} className="w-full p-2 bg-purple-900/40 text-purple-400 rounded border border-purple-500/50 text-sm font-bold flex items-center justify-center gap-2 shadow-[0_0_10px_rgba(168,85,247,0.1)]">Save as Custom Gate</motion.button>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => setShowTruthTable(true)} className="w-full p-2 bg-neon-blue/20 text-neon-blue rounded border border-neon-blue/50 text-sm font-bold flex items-center justify-center gap-2 shadow-[0_0_10px_rgba(59,130,246,0.1)]">Analyze Truth Table</motion.button>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={handleExportVerilog} className="w-full p-2 bg-slate-800 text-neon-green rounded border border-neon-green/50 text-sm font-bold flex items-center justify-center gap-2 shadow-[0_0_10px_rgba(34,197,94,0.1)]">Export to Verilog</motion.button>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={handleShare} className="w-full p-2 bg-slate-800 text-slate-300 rounded border border-slate-700 text-sm font-bold flex items-center justify-center gap-2">Copy Share Link</motion.button>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => setShowProjectManager(true)} className="w-full p-2 bg-slate-800 text-slate-300 rounded border border-slate-700 text-sm font-bold flex items-center justify-center gap-2">Manage Projects</motion.button>
          <ScreenRecorder />
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={handleClear} className="w-full p-2 bg-red-900/20 text-red-400 rounded border border-red-800/50 text-sm font-bold">Clear Canvas</motion.button>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => setShowTutorial(true)} className="w-full p-2 bg-indigo-900/30 text-indigo-400 rounded border border-indigo-800/50 text-sm font-bold flex items-center justify-center gap-2 mt-2"><HelpCircle className="w-4 h-4"/> Take a Tour</motion.button>
        </div>
      </motion.div>
      <div className="flex-1 h-full relative" ref={reactFlowWrapper}>
        <div id="tour-clock-panel" className="absolute top-4 left-4 z-50 bg-slate-900/90 backdrop-blur-md p-3 rounded-xl border-2 border-slate-700 shadow-xl flex items-center gap-4">
           <div className="flex items-center gap-2">
             <button onClick={() => { globalClock.play(); setClockRunning(true); }} className={cn("p-2 rounded hover:bg-slate-700", clockRunning ? "text-neon-green" : "text-slate-400")}>
               <Play className="w-5 h-5" />
             </button>
             <button onClick={() => { globalClock.pause(); setClockRunning(false); }} className={cn("p-2 rounded hover:bg-slate-700", !clockRunning ? "text-yellow-400" : "text-slate-400")}>
               <Pause className="w-5 h-5" />
             </button>
             <button onClick={() => { globalClock.step(); setClockRunning(false); }} className="p-2 rounded text-neon-blue hover:bg-slate-700">
               <StepForward className="w-5 h-5" />
             </button>
           </div>
           <div className="h-6 w-px bg-slate-700"></div>
           <div className="flex items-center gap-2 text-slate-300">
             <FastForward className="w-4 h-4 text-slate-400" />
             <input 
               type="range" min="1" max="20" value={clockFreq} 
               onChange={(e) => { 
                 const val = parseInt(e.target.value);
                 setClockFreq(val);
                 globalClock.setFrequency(val);
               }} 
               className="w-24 accent-neon-blue"
             />
             <span className="text-xs font-mono w-8">{clockFreq}Hz</span>
           </div>
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onSelectionChange={onSelectionChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={{ type: 'default' }}
          fitView
          className="bg-black"
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#334155" gap={20} size={1} />
          <Controls className="bg-slate-800 border-slate-700 fill-slate-300" />
          <Panel position="top-right" className="bg-slate-900/80 p-3 rounded-lg border border-slate-700 backdrop-blur-md shadow-lg flex flex-col items-end gap-3 pointer-events-none">
             <p className="text-sm text-slate-300 text-right pointer-events-auto">Drag components from the sidebar.<br/>Connect nodes to see real-time logic.</p>
             <AnimatePresence>
                {selectedNodes.length > 0 && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleDeleteSelected}
                    className="flex items-center gap-2 bg-red-900/90 text-red-400 border border-red-800 px-4 py-2 rounded-lg font-bold shadow-lg pointer-events-auto hover:bg-red-800 hover:text-white transition"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete Selected
                  </motion.button>
                )}
             </AnimatePresence>
          </Panel>
        </ReactFlow>
        <AnimatePresence>
        </AnimatePresence>
        <AnimatePresence>
          {showTruthTable && (
            <TruthTableAnalyzer 
              nodes={nodes} 
              edges={edges} 
              onClose={() => setShowTruthTable(false)}
              onSynthesize={handleSynthesize}
            />
          )}
        </AnimatePresence>
        <ProjectManager 
          isOpen={showProjectManager} 
          onClose={() => setShowProjectManager(false)} 
          onSave={handleSaveProject} 
          onLoad={handleLoadProject} 
        />
        <MultiplayerManager 
          nodes={nodes}
          edges={edges}
          setNodes={setNodes}
          setEdges={setEdges}
        />
        <div id="tour-multiplayer" className="absolute top-4 right-20 w-10 h-10 pointer-events-none z-40"></div>
      </div>
      <AnimatePresence>
        {show3D && (
          <Circuit3DViewer nodes={nodes} edges={edges} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {verilogCode !== null && (
         <motion.div 
         initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 z-50 flex items-center justify-center p-8 backdrop-blur-sm"
         >
            <motion.div 
               initial={{ scale: 0.9, y: 30 }}
               animate={{ scale: 1, y: 0 }}
               exit={{ scale: 0.9, y: 30 }}
               className="bg-slate-900 border-2 border-neon-green rounded-xl w-full max-w-3xl max-h-full flex flex-col shadow-[0_0_50px_rgba(34,197,94,0.4)]"
            >
               <div className="p-4 border-b border-slate-700 flex justify-between items-center">
                  <h2 className="text-xl font-bold text-neon-green tracking-wider">Verilog Hardware Export</h2>
                  <button onClick={() => setVerilogCode(null)} className="text-slate-400 hover:text-white font-bold">Close</button>
               </div>
               <div className="p-6 overflow-y-auto flex-1">
                  <pre className="text-sm font-mono text-slate-300 bg-slate-950 p-6 rounded-lg border border-slate-800 overflow-x-auto shadow-inner">
                    {verilogCode}
                  </pre>
               </div>
               <div className="p-4 border-t border-slate-700">
                  <motion.button 
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => { navigator.clipboard.writeText(verilogCode); alert('Code copied to clipboard!'); }} 
                    className="w-full py-3 bg-neon-green text-black font-bold rounded-lg transition shadow-[0_0_15px_rgba(34,197,94,0.4)]"
                  >
                    Copy to Clipboard
                  </motion.button>
               </div>
            </motion.div>
         </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}
type Tab = 'sandbox' | 'canvas' | 'challenge';
function App() {
  const [activeTab, setActiveTab] = useState<Tab>('sandbox');
  return (
    <div className="min-h-screen flex flex-col font-sans">
      <header className="bg-panel-dark border-b border-slate-800 p-4 shadow-md flex justify-between items-center z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center border border-slate-700 shadow-sm relative overflow-hidden">
             <div className="absolute inset-0 bg-neon-blue/10 blur-xl"></div>
             <Cpu className="text-neon-blue w-6 h-6 relative z-10" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-br from-neon-blue to-neon-green">
            Play with Gates
          </h1>
        </div>
        <nav className="flex gap-2">
          <NavButton active={activeTab === 'sandbox'} onClick={() => setActiveTab('sandbox')} icon={<Cpu className="w-4 h-4" />}>Gate Sandbox</NavButton>
          <NavButton active={activeTab === 'canvas'} onClick={() => setActiveTab('canvas')} icon={<Network className="w-4 h-4" />}>Circuit Canvas</NavButton>
          <NavButton active={activeTab === 'challenge'} onClick={() => setActiveTab('challenge')} icon={<Target className="w-4 h-4" />}>Challenge</NavButton>
        </nav>
      </header>
      <main className="flex-1 overflow-hidden relative bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-bg-dark to-black">
        {activeTab === 'sandbox' && <SingleGateExplorer />}
        {activeTab === 'canvas' && <div className="absolute inset-0"><CircuitCanvas /></div>}
        {activeTab === 'challenge' && <div className="absolute inset-0"><ChallengeMode /></div>}
      </main>
    </div>
  );
}
function NavButton({ active, children, onClick, icon }: { active: boolean, children: React.ReactNode, onClick: () => void, icon?: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-4 py-2 rounded-md font-medium text-sm transition-all duration-300 flex items-center gap-2",
        active 
          ? "bg-slate-800 text-neon-blue border border-slate-700 shadow-[0_0_15px_rgba(59,130,246,0.15)]" 
          : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent"
      )}
    >
      {icon}
      {children}
    </button>
    );
}
export default App;
const evaluateGate = (type: GateType, inputs: number[]): number => {
  const a = inputs[0] ?? 0;
  const b = inputs[1] ?? 0;
  switch (type) {
    case 'AND': return (a && b) ? 1 : 0;
    case 'OR': return (a || b) ? 1 : 0;
    case 'NOT': return a === 0 ? 1 : 0;
    case 'NAND': return !(a && b) ? 1 : 0;
    case 'NOR': return !(a || b) ? 1 : 0;
    case 'XOR': return a !== b ? 1 : 0;
    case 'XNOR': return a === b ? 1 : 0;
    default: return 0;
  }
};
const getExpectedInputCount = (type: GateType): number => {
  if (type === 'NOT') return 1;
  return 2;
};
const generateTruthTable = (type: GateType) => {
  const inputsCount = getExpectedInputCount(type);
  if (inputsCount === 1) {
    return [
      { inputs: [0], output: evaluateGate(type, [0]) },
      { inputs: [1], output: evaluateGate(type, [1]) },
    ];
  }
  return [
    { inputs: [0, 0], output: evaluateGate(type, [0, 0]) },
    { inputs: [0, 1], output: evaluateGate(type, [0, 1]) },
    { inputs: [1, 0], output: evaluateGate(type, [1, 0]) },
    { inputs: [1, 1], output: evaluateGate(type, [1, 1]) },
  ];
}
interface ToggleSwitchProps {
  value: number;
  onChange: (val: number) => void;
  label?: string;
  }
function ToggleSwitch({ value, onChange, label }: ToggleSwitchProps) {
  const isHigh = value === 1;
  return (
    <div className="flex flex-col items-center gap-3">
      {label && <span className="text-slate-400 font-mono text-sm uppercase tracking-wider">{label}</span>}
      <button
        onClick={() => onChange(isHigh ? 0 : 1)}
        className={cn(
          "relative w-14 h-24 rounded-lg border-2 flex flex-col items-center p-1 cursor-pointer transition-colors duration-300 overflow-hidden",
          isHigh 
            ? "border-neon-green bg-neon-green/10 shadow-[0_0_15px_rgba(34,197,94,0.3)]" 
            : "border-slate-700 bg-slate-900 shadow-inner"
        )}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 to-transparent pointer-events-none" />
        <motion.div
          className={cn(
            "w-full h-10 rounded shadow-md flex items-center justify-center font-bold text-xl transition-colors relative z-10",
            isHigh ? "bg-neon-green text-black" : "bg-slate-700 text-slate-400"
          )}
          animate={{ y: isHigh ? 0 : 40 }}
          transition={{ type: "spring", stiffness: 600, damping: 30 }}
        >
          {value}
        </motion.div>
      </button>
    </div>
  );
}
interface GateVisualizerProps {
  type: GateType;
  output: number;
}
function GateVisualizer({ type, output }: GateVisualizerProps) {
  const isHigh = output === 1;
  const getPaths = () => {
    switch (type) {
      case 'AND':
        return <path d="M 20 10 L 45 10 A 25 25 0 0 1 45 60 L 20 60 Z" />;
        case 'NAND':
        return (
          <>
            <path d="M 15 10 L 40 10 A 25 25 0 0 1 40 60 L 15 60 Z" />
            <circle cx="70" cy="35" r="5" />
          </>
        );
      case 'OR':
        return <path d="M 20 10 Q 45 10 65 35 Q 45 60 20 60 Q 30 35 20 10 Z" />;
      case 'NOR':
        return (
          <>
            <path d="M 15 10 Q 40 10 60 35 Q 40 60 15 60 Q 25 35 15 10 Z" />
            <circle cx="65" cy="35" r="5" />
          </>
        );
      case 'XOR':
        return (
          <>
            <path d="M 10 10 Q 20 35 10 60" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
            <path d="M 20 10 Q 45 10 65 35 Q 45 60 20 60 Q 30 35 20 10 Z" />
          </>
        );
      case 'XNOR':
        return (
          <>
            <path d="M 5 10 Q 15 35 5 60" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
            <path d="M 15 10 Q 40 10 60 35 Q 40 60 15 60 Q 25 35 15 10 Z" />
            <circle cx="65" cy="35" r="5" />
          </>
        );
      case 'NOT':
        return (
          <>
            <path d="M 25 15 L 55 35 L 25 55 Z" />
            <circle cx="60" cy="35" r="5" />
          </>
        );
      case 'MUX':
        return (
          <>
            <path d="M 25 5 L 55 15 L 55 55 L 25 65 Z" fill={isHigh ? 'rgba(34,197,94,0.1)' : 'rgba(71,85,105,0.2)'} />
            <text x="38" y="39" fontSize="12" fill="currentColor" textAnchor="middle" className="font-bold font-mono border-none outline-none select-none">MUX</text>
          </>
        );
      default:
        return null;
    }
  };
  return (
    <motion.div 
      className="relative flex items-center justify-center p-8 bg-slate-800/50 rounded-2xl border border-slate-700/50 backdrop-blur-sm"
      animate={{ scale: isHigh ? 1.05 : 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
    >
      <svg 
        viewBox="0 0 100 70" 
        className={cn(
          "w-48 h-32 transition-all duration-300 drop-shadow-xl",
          isHigh ? "text-neon-green drop-shadow-[0_0_15px_rgba(34,197,94,0.6)]" : "text-slate-500"
        )}
      >
        <g fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round">
          {getPaths()}
        </g>
      </svg>
      <div className="absolute top-4 right-4 uppercase text-xs font-bold tracking-widest text-slate-500">
        {type}
      </div>
    </motion.div>
  );
}
interface AnimatedWireProps {
  value: number;
  orientation?: 'horizontal' | 'vertical' | 'curved';
  path?: string;
  width?: number;
  height?: number;
  className?: string;
}
function AnimatedWire({ value, orientation = 'horizontal', path, width = 100, height = 20, className }: AnimatedWireProps) {
  const isHigh = value === 1;
  if (path) {
    return (
      <svg className={cn("overflow-visible", className)} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <path
          d={path}
          fill="none"
          stroke={isHigh ? "#22c55e" : "#475569"}
          strokeWidth="6"
          className="transition-colors duration-300"
          strokeLinecap="round"
        />
        {isHigh && (
          <path
            d={path}
            fill="none"
            stroke="#10b981"
            strokeWidth="6"
            strokeDasharray="10 15"
            strokeLinecap="round"
            className="animate-flow drop-shadow-[0_0_8px_rgba(34,197,94,0.8)]"
          />
        )}
      </svg>
    );
  }
  const isHorizontal = orientation === 'horizontal';
  return (
    <div className={cn("relative flex items-center justify-center", className)} style={{ width: isHorizontal ? width : 6, height: isHorizontal ? 6 : height }}>
      <div className={cn("absolute bg-slate-600 rounded-full transition-colors duration-300", isHorizontal ? "h-1.5 w-full" : "w-1.5 h-full", isHigh && "bg-neon-green shadow-[0_0_10px_rgba(34,197,94,0.6)]")} />
      {isHigh && (
        <div 
          className={cn(
            "absolute rounded-full bg-white opacity-80", 
            isHorizontal ? "h-1.5 w-full" : "w-1.5 h-full"
          )}
          style={{
            backgroundImage: isHorizontal ? 'repeating-linear-gradient(90deg, transparent, transparent 10px, rgba(255,255,255,0.8) 10px, rgba(255,255,255,0.8) 20px)' : 'repeating-linear-gradient(0deg, transparent, transparent 10px, rgba(255,255,255,0.8) 10px, rgba(255,255,255,0.8) 20px)',
            backgroundSize: '200% 200%',
            animation: isHorizontal ? 'flow 1s linear infinite' : 'flow 1s linear infinite',
          }}
        />
      )}
    </div>
  );
}
interface DynamicTruthTableProps {
  type: GateType;
  currentInputs: number[];
}
function DynamicTruthTable({ type, currentInputs }: DynamicTruthTableProps) {
  const table = generateTruthTable(type);
  const inputsCount = table[0].inputs.length;
  return (
    <div className="bg-panel-dark rounded-xl border border-slate-700 overflow-hidden shadow-lg w-full max-w-sm">
      <div className="bg-slate-800 p-3 border-b border-slate-700 font-bold text-center text-slate-200">
        Truth Table: {type}
      </div>
      <table className="w-full text-center border-collapse">
        <thead>
          <tr className="bg-slate-800/50 text-slate-400 text-sm">
            {inputsCount > 1 && <th className="p-3 border-b border-slate-700 border-r w-1/3">Input A</th>}
            <th className="p-3 border-b border-slate-700 border-r w-1/3">{inputsCount > 1 ? 'Input B' : 'Input A'}</th>
            <th className="p-3 border-b border-slate-700 w-1/3 text-neon-blue">Output Y</th>
          </tr>
        </thead>
        <tbody>
          {table.map((row, i) => {
            const isActive = currentInputs.every((val, idx) => val === row.inputs[idx]);
            return (
              <tr 
                key={i} 
                className={cn(
                  "transition-colors duration-300",
                  isActive ? "bg-neon-blue/20" : "hover:bg-slate-800/50"
                )}
              >
                {inputsCount > 1 && (
                  <td className={cn("p-3 border-b border-slate-700/50 border-r font-mono", isActive ? "text-white" : "text-slate-400")}>
                    {row.inputs[0]}
                  </td>
                )}
                <td className={cn("p-3 border-b border-slate-700/50 border-r font-mono", isActive ? "text-white" : "text-slate-400")}>
                  {row.inputs[inputsCount > 1 ? 1 : 0]}
                </td>
                <td className={cn("p-3 border-b border-slate-700/50 font-bold font-mono", isActive ? "text-neon-green drop-shadow-[0_0_8px_rgba(34,197,94,0.5)]" : "text-slate-500")}>
                  {row.output}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function SingleGateExplorer() {
  const [activeType, setActiveType] = useState<GateType>('AND');
  const [inputs, setInputs] = useState<number[]>([0, 0]);
  const expectedInputs = getExpectedInputCount(activeType);
  const currentInputs = inputs.slice(0, expectedInputs);
  const output = evaluateGate(activeType, currentInputs);
  const handleInputToggle = (index: number, val: number) => {
    const newInputs = [...inputs];
    newInputs[index] = val;
    setInputs(newInputs);
  };
  const handleTypeChange = (t: GateType) => {
    setActiveType(t);
  };
  return (
    <div className="flex flex-col h-full overflow-y-auto w-full max-w-6xl mx-auto p-4 md:p-8">
      <div className="flex flex-wrap justify-center gap-3 mb-16 mt-4">
        {GATE_TYPES.map(type => (
          <button
            key={type}
            onClick={() => handleTypeChange(type)}
            className={cn(
              "px-6 py-2 rounded-full font-bold text-sm transition-all duration-300 border",
              activeType === type 
                ? "bg-neon-blue/20 text-neon-blue border-neon-blue shadow-[0_0_15px_rgba(59,130,246,0.3)]" 
                : "bg-slate-800/80 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200"
            )}
          >
            {type}
          </button>
        ))}
      </div>
      <div className="flex flex-col xl:flex-row gap-16 items-center justify-center mt-8">
        <div className="flex items-center gap-0 lg:gap-2 relative flex-1 min-w-[300px] justify-center scale-90 md:scale-100 xl:scale-110 xl:ml-8">
          <div className="flex flex-col gap-[3rem] justify-center mr-0">
            {expectedInputs > 1 ? (
              <>
                <ToggleSwitch label="Input A" value={inputs[0]} onChange={(val) => handleInputToggle(0, val)} />
                <ToggleSwitch label="Input B" value={inputs[1]} onChange={(val) => handleInputToggle(1, val)} />
              </>
            ) : (
              <ToggleSwitch label="Input A" value={inputs[0]} onChange={(val) => handleInputToggle(0, val)} />
            )}
          </div>
          <div className="flex flex-col justify-center gap-[6.5rem]">
             {expectedInputs > 1 ? (
               <>
                 <AnimatedWire value={inputs[0]} width={60} />
                 <AnimatedWire value={inputs[1]} width={60} />
               </>
             ) : (
               <AnimatedWire value={inputs[0]} width={60} />
             )}
          </div>
          <div className="relative z-10 mx-1">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeType}
                initial={{ opacity: 0, scale: 0.8, filter: 'blur(4px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, scale: 0.8, filter: 'blur(4px)' }}
                transition={{ duration: 0.3 }}
              >
                <GateVisualizer type={activeType} output={output} />
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="mx-1">
            <AnimatedWire value={output} width={70} />
          </div>
          <div className="ml-2">
            <div className="flex flex-col items-center gap-4">
              <span className="text-slate-400 font-mono text-sm uppercase tracking-wider">Output Y</span>
              <div className="relative">
                {output === 1 && <div className="absolute inset-0 bg-neon-green rounded-full blur-xl opacity-60 animate-pulse-glow" />}
                <div 
                  className={cn(
                    "w-20 h-20 rounded-full transition-all duration-300 flex items-center justify-center font-bold text-3xl border-4 relative z-10",
                    output === 1 
                      ? "bg-black border-neon-green text-neon-green" 
                      : "bg-slate-900 border-slate-700 text-slate-700"
                  )}
                >
                  {output}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="w-full flex justify-center xl:justify-end xl:mr-8 max-w-md">
          <DynamicTruthTable type={activeType} currentInputs={currentInputs} />
        </div>
      </div>
    </div>
  );
}
function ChallengeMode() {
  const [currentLevel, setCurrentLevel] = useState<Level>(LEVELS[0]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [isSuccess, setIsSuccess] = useState(false);
  const [hasTested, setHasTested] = useState(false);
  useEffect(() => {
    resetLevel(LEVELS[0]);
  }, []);
  const onToggleInput = (id: string) => {
    setNodes(nds => nds.map(nd => nd.id === id ? { ...nd, data: { ...nd.data, value: nd.data.value === 0 ? 1 : 0 } } : nd));
  };
  const resetLevel = (lvl: Level) => {
    setCurrentLevel(lvl);
    setIsSuccess(false);
    setHasTested(false);
    setNodes([
      { id: 'in1', type: 'inputNode', position: { x: 100, y: 150 }, data: { id: 'in1', value: 0, onToggle: onToggleInput }, draggable: false, deletable: false },
      { id: 'in2', type: 'inputNode', position: { x: 100, y: 350 }, data: { id: 'in2', value: 0, onToggle: onToggleInput }, draggable: false, deletable: false },
      { id: 'out1', type: 'outputNode', position: { x: 800, y: 250 }, data: { id: 'out1', value: 0 }, draggable: false, deletable: false },
    ]);
    setEdges([]);
  };
  const handleVerify = () => {
     let passed = true;
     for (const row of currentLevel.targetTruthTable) {
        const result = simulateCircuit(nodes, edges, row.inputs);
        if (result !== row.output) {
           passed = false;
           break;
        }
     }
     setHasTested(true);
     if (passed) {
       setIsSuccess(true);
     }
  };
  const nextLevel = () => {
    if (currentLevel.id < LEVELS.length) {
      resetLevel(LEVELS[currentLevel.id]); 
    } else {
      resetLevel(generateRandomLevel(currentLevel.id + 1));
    }
  };
  return (
    <div className="flex h-full w-full relative">
      <div className="w-80 bg-slate-900 border-r border-slate-700 flex flex-col z-10 shadow-2xl relative">
        <div className="p-6 border-b border-slate-700">
          <div className="text-neon-blue font-bold tracking-widest text-xs uppercase mb-2">Level {currentLevel.id}</div>
          <h2 className="text-2xl font-bold text-slate-100 mb-2">{currentLevel.title}</h2>
          <p className="text-slate-400 text-sm leading-relaxed">{currentLevel.description}</p>
        </div>
        <div className="p-6 flex-1 overflow-y-auto">
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Target Output</h3>
          <table className="w-full text-center border-collapse text-sm">
            <thead>
              <tr className="bg-slate-800 text-slate-400">
                <th className="p-2 border border-slate-700">A</th>
                <th className="p-2 border border-slate-700">B</th>
                <th className="p-2 border border-slate-700 text-neon-blue">Y</th>
              </tr>
            </thead>
            <tbody>
              {currentLevel.targetTruthTable.map((row, i) => (
                <tr key={i} className="hover:bg-slate-800/50">
                  <td className="p-2 border border-slate-700 text-slate-300 font-mono">{row.inputs[0]}</td>
                  <td className="p-2 border border-slate-700 text-slate-300 font-mono">{row.inputs[1]}</td>
                  <td className="p-2 border border-slate-700 font-bold text-neon-green font-mono">{row.output}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-6 bg-slate-900 border-t border-slate-700 mt-auto">
           {isSuccess ? (
             <motion.div 
               initial={{ scale: 0.9, opacity: 0 }} 
               animate={{ scale: 1, opacity: 1 }}
               className="flex flex-col gap-4"
             >
               <div className="flex items-center gap-2 text-neon-green font-bold justify-center">
                 <Trophy className="w-5 h-5" /> Challenge Passed!
               </div>
               <button 
                 onClick={nextLevel}
                 className="w-full py-3 bg-neon-green text-black font-bold rounded-lg shadow-[0_0_15px_rgba(34,197,94,0.4)] hover:bg-green-400 transition-colors flex items-center justify-center gap-2"
               >
                Next Challenge <Play className="w-4 h-4 fill-current" />
               </button>
             </motion.div>
           ) : (
             <button 
               onClick={handleVerify}
               className={cn(
                 "w-full py-3 font-bold rounded-lg transition-colors flex items-center justify-center gap-2",
                 hasTested && !isSuccess ? "bg-red-500/20 text-red-400 border border-red-500/50" : "bg-neon-blue text-black hover:bg-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.4)]"
               )}
             >
               <CheckCircle2 className="w-5 h-5" /> {hasTested && !isSuccess ? "Incorrect. Try Again" : "Verify Circuit"}
             </button>
           )}
        </div>
      </div>
      <div className="flex-1 relative">
         <CircuitCanvas 
           nodes={nodes}
           setNodes={setNodes}
           onNodesChange={onNodesChange}
           edges={edges}
           setEdges={setEdges}
           onEdgesChange={onEdgesChange}
           allowedGates={currentLevel.allowedGates}
         />
         <AnimatePresence>
            {isSuccess && (
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-neon-green/10 pointer-events-none z-50 flex items-center justify-center backdrop-blur-[2px]"
              >
                 <motion.div 
                   initial={{ scale: 0.5, y: 50 }}
                   animate={{ scale: 1, y: 0 }}
                   className="bg-slate-900 border-2 border-neon-green p-8 rounded-2xl shadow-[0_0_50px_rgba(34,197,94,0.5)] flex flex-col items-center gap-4"
                 >
                   <Trophy className="w-16 h-16 text-neon-green drop-shadow-[0_0_15px_rgba(34,197,94,0.8)]" />
                   <h2 className="text-3xl font-bold text-slate-100">Excellent!</h2>
                   <p className="text-slate-400 text-center max-w-xs">Your logic gates correctly resolved all possible input states.</p>
                 </motion.div>
              </motion.div>
            )}
         </AnimatePresence>
      </div>
    </div>
  );
}
export interface Level {
  id: number;
  title: string;
  description: string;
  targetTruthTable: { inputs: number[], output: number }[];
  allowedGates: GateType[];
}
export const LEVELS: Level[] = [
  {
    "id": 1,
    "title": "The Basics: AND Logic",
    "description": "Connect the inputs to an AND gate to match the truth table.",
    "allowedGates": [
      "AND"
    ],
    "targetTruthTable": [
      {
        "inputs": [
          0,
          0
        ],
        "output": 0
      },
      {
        "inputs": [
          0,
          1
        ],
        "output": 0
      },
      {
        "inputs": [
          1,
          0
        ],
        "output": 0
      },
      {
        "inputs": [
          1,
          1
        ],
        "output": 1
      }
    ]
  },
  {
    "id": 2,
    "title": "Any Signal Will Do",
    "description": "Build a circuit that outputs 1 if AT LEAST ONE input is 1.",
    "allowedGates": [
      "OR",
      "AND"
    ],
    "targetTruthTable": [
      {
        "inputs": [
          0,
          0
        ],
        "output": 0
      },
      {
        "inputs": [
          0,
          1
        ],
        "output": 1
      },
      {
        "inputs": [
          1,
          0
        ],
        "output": 1
      },
      {
        "inputs": [
          1,
          1
        ],
        "output": 1
      }
    ]
  },
  {
    "id": 3,
    "title": "The Exclusivity Rule",
    "description": "Build an XOR logic gate using only AND, OR, and NOT gates.",
    "allowedGates": [
      "AND",
      "OR",
      "NOT"
    ],
    "targetTruthTable": [
      {
        "inputs": [
          0,
          0
        ],
        "output": 0
      },
      {
        "inputs": [
          0,
          1
        ],
        "output": 1
      },
      {
        "inputs": [
          1,
          0
        ],
        "output": 1
      },
      {
        "inputs": [
          1,
          1
        ],
        "output": 0
      }
    ]
  },
  {
    "id": 4,
    "title": "3-Input NAND",
    "description": "Output 0 only when all 3 inputs are 1.",
    "allowedGates": [
      "NAND",
      "AND",
      "NOT"
    ],
    "targetTruthTable": [
      {
        "inputs": [
          0,
          0,
          0
        ],
        "output": 1
      },
      {
        "inputs": [
          0,
          0,
          1
        ],
        "output": 1
        },
      {
        "inputs": [
          0,
          1,
          0
        ],
        "output": 1
      },
      {
        "inputs": [
          0,
          1,
          1
        ],
        "output": 1
      },
      {
        "inputs": [
          1,
          0,
          0
        ],
        "output": 1
      },
      {
        "inputs": [
          1,
          0,
          1
        ],
        "output": 1
      },
      {
        "inputs": [
          1,
          1,
          0
        ],
        "output": 1
        },
      {
        "inputs": [
          1,
          1,
          1
        ],
        "output": 0
      }
    ]
  },
  {
    "id": 5,
    "title": "2-to-1 Multiplexer",
    "description": "Use the first input (Select) to choose between the second (A) and third (B) inputs.",
    "allowedGates": [
      "AND",
      "OR",
      "NOT"
    ],
    "targetTruthTable": [
      {
        "inputs": [
          0,
          0,
          0
        ],
        "output": 0
      },
      {
        "inputs": [
          0,
          0,
          1
        ],
        "output": 0
      },
      {
        "inputs": [
          0,
          1,
          0
        ],
        "output": 1
      },
      {
        "inputs": [
          0,
          1,
          1
        ],
        "output": 1
      },
      {
        "inputs": [
          1,
          0,
          0
        ],
        "output": 0
      },
      {
        "inputs": [
          1,
          0,
          1
        ],
        "output": 1
      },
      {
        "inputs": [
          1,
          1,
          0
        ],
        "output": 0
      },
      {
        "inputs": [
          1,
           1,
          1
        ],
        "output": 1
      }
    ]
  },
  {
    "id": 6,
    "title": "Majority Rules",
    "description": "Output 1 if two or more inputs are 1.",
    "allowedGates": [
      "AND",
      "OR"
    ],
    "targetTruthTable": [
      {
        "inputs": [
          0,
          0,
          0
        ],
        "output": 0
      },
      {
        "inputs": [
          0,
          0,
          1
        ],
        "output": 0
      },
      {
        "inputs": [
          0,
          1,
          0
        ],
        "output": 0
      },
      {
        "inputs": [
          0,
          1,
          1
        ],
        "output": 1
      },
      {
        "inputs": [
          1,
          0,
          0
        ],
        "output": 0
      },
      {
        "inputs": [
          1,
          0,
          1
        ],
        "output": 1
      },
      {
        "inputs": [
          1,
          1,
          0
        ],
        "output": 1
      },
      {
        "inputs": [
          1,
          1,
          1
        ],
        "output": 1
      }
      ]
  },
  {
    "id": 7,
    "title": "Odd Parity",
    "description": "Output 1 if there is an odd number of 1s in the inputs.",
    "allowedGates": [
      "XOR",
      "NOT",
      "AND",
      "OR"
    ],
    "targetTruthTable": [
      {
        "inputs": [
          0,
          0,
          0
        ],
        "output": 0
      },
      {
        "inputs": [
          0,
          0,
          1
        ],
        "output": 1
      },
      {
        "inputs": [
          0,
          1,
          0
        ],
        "output": 1
      },
      {
        "inputs": [
          0,
          1,
          1
        ],
        "output": 0
      },
      {
        "inputs": [
          1,
          0,
          0
        ],
        "output": 1
      },
      {
        "inputs": [
          1,
          0,
          1
        ],
        "output": 0
      },
      {
        "inputs": [
          1,
          1,
          0
        ],
        "output": 0
      },
      {
        "inputs": [
          1,
          1,
          1
        ],
        "output": 1
      }
    ]
  },
  {
     "id": 8,
    "title": "2-Bit Comparator",
    "description": "Compare two 2-bit numbers (A and B). Output 1 if they are equal.",
    "allowedGates": [
      "XNOR",
      "AND",
      "XOR",
      "NOT",
      "NOR"
    ],
    "targetTruthTable": [
      {
        "inputs": [
          0,
          0,
          0,
          0
        ],
        "output": 1
      },
      {
        "inputs": [
          0,
          0,
          0,
          1
        ],
        "output": 0
      },
      {
        "inputs": [
          0,
          0,
          1,
          0
        ],
        "output": 0
      },
      {
        "inputs": [
           0,
          0,
          1,
          1
        ],
        "output": 0
      },
      {
        "inputs": [
          0,
          1,
          0,
          0
        ],
        "output": 0
      },
      {
        "inputs": [
          0,
          1,
          0,
          1
        ],
        "output": 1
      },
      {
        "inputs": [
          0,
          1,
          1,
          0
        ],
        "output": 0
      },
      {
        "inputs": [
          0,
          1,
          1,
          1
          ],
        "output": 0
      },
      {
        "inputs": [
          1,
          0,
          0,
          0
        ],
        "output": 0
      },
      {
        "inputs": [
          1,
          0,
          0,
          1
        ],
        "output": 0
      },
      {
        "inputs": [
          1,
          0,
          1,
          0
        ],
        "output": 1
      },
      {
        "inputs": [
          1,
          0,
          1,
          1
        ],
        "output": 0
      },
      {
        "inputs": [
          1,
          1,
          0,
          0
        ],
        "output": 0
      },
      {
        "inputs": [
          1,
          1,
          0,
          1
        ],
        "output": 0
      },
      {
        "inputs": [
          1,
          1,
          1,
          0
        ],
        "output": 0
      },
      {
        "inputs": [
          1,
          1,
          1,
          1
        ],
        "output": 1
      }
    ]
  },
  {
    "id": 9,
    "title": "4-Input AND",
    "description": "Output 1 only when all 4 inputs are 1.",
    "allowedGates": [
      "AND"
    ],
    "targetTruthTable": [
      {
        "inputs": [
          0,
          0,
          0,
          0
        ],
        "output": 0
      },
      {
        "inputs": [
          0,
          0,
          0,
          1
        ],
        "output": 0
      },
      {
        "inputs": [
          0,
          0,
          1,
          0
        ],
        "output": 0
      },
      {
        "inputs": [
          0,
          0,
          1,
          1
        ],
        "output": 0
        },
      {
        "inputs": [
          0,
          1,
          0,
          0
        ],
        "output": 0
      },
      {
        "inputs": [
          0,
          1,
          0,
          1
        ],
        "output": 0
      },
      {
        "inputs": [
          0,
          1,
          1,
          0
        ],
        "output": 0
      },
      {
        "inputs": [
          0,
          1,
          1,
          1
        ],
        "output": 0
      },
      {
        "inputs": [
          1,
           0,
          0,
          0
        ],
        "output": 0
      },
      {
        "inputs": [
          1,
          0,
          0,
          1
        ],
        "output": 0
      },
      {
        "inputs": [
          1,
          0,
          1,
          0
        ],
        "output": 0
      },
      {
        "inputs": [
          1,
          0,
          1,
          1
        ],
        "output": 0
      },
      {
        "inputs": [
          1,
          1,
          0,
          0
        ],