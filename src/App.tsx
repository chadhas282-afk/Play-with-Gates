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