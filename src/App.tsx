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