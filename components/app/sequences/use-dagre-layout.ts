"use client";

import { useMemo } from "react";
import dagre from "dagre";
import type { Edge, Node } from "@xyflow/react";

const NODE_WIDTH = 260;
const NODE_HEIGHT = 88;

/** Per-type box sizes so dagre centers narrow nodes (trigger/end) correctly. */
function sizeOf(node: Node): { width: number; height: number } {
  if (node.type === "terminal") return { width: 120, height: 36 };
  return { width: NODE_WIDTH, height: NODE_HEIGHT };
}

export type DagreLayout = {
  nodes: Node[];
  /** Orthogonal routing points per edge id (dagre routes around nodes). */
  edgePoints: Record<string, { x: number; y: number }[]>;
};

/**
 * Computes vertical (top-to-bottom) positions for the sequence graph with
 * dagre, AND returns dagre's per-edge routing points. We feed the edge id as
 * the dagre edge name so parallel branches (multiple edges to the same target)
 * stay distinct, and we render each edge along its points — so a branch that
 * skips a rank routes *around* the intermediate node instead of straight
 * through it.
 */
export function useDagreLayout(nodes: Node[], edges: Edge[]): DagreLayout {
  return useMemo(() => {
    const g = new dagre.graphlib.Graph({ multigraph: true });
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: "TB", nodesep: 80, ranksep: 70 });

    for (const node of nodes) {
      const { width, height } = sizeOf(node);
      g.setNode(node.id, { width, height });
    }
    for (const edge of edges) {
      g.setEdge(edge.source, edge.target, {}, edge.id);
    }

    dagre.layout(g);

    const positioned = nodes.map((node) => {
      const pos = g.node(node.id);
      if (!pos) return node;
      const { width, height } = sizeOf(node);
      return {
        ...node,
        position: { x: pos.x - width / 2, y: pos.y - height / 2 },
      };
    });

    const edgePoints: Record<string, { x: number; y: number }[]> = {};
    for (const edge of edges) {
      const de = g.edge(edge.source, edge.target, edge.id) as { points?: { x: number; y: number }[] } | undefined;
      if (de?.points?.length) {
        edgePoints[edge.id] = de.points.map((p) => ({ x: p.x, y: p.y }));
      }
    }

    return { nodes: positioned, edgePoints };
  }, [nodes, edges]);
}

export const SEQUENCE_NODE_SIZE = { width: NODE_WIDTH, height: NODE_HEIGHT };
