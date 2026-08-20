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