"use client";

import { useMemo } from "react";
import type { Edge, Node } from "@xyflow/react";

/**
 * Deterministic layered ("tidy tree") layout for the sequence graph.
 *
 * Replaces dagre : dagre's crossing-minimization reorders sibling columns when
 * a merge adds a transversal edge, which flips the authored left→right order.
 * Here the column order is fixed by a depth-first walk in authored slot order,
 * so branches always keep their declared order. Edges are routed orthogonally
 * through the empty gaps between ranks, so a line never crosses a node and is
 * never diagonal.
 *
 * Returns positioned nodes + per-edge orthogonal corner points (consumed by
 * SequenceInsertEdge).
 */

const NODE_WIDTH = 260;
const NODE_HEIGHT = 88;
// One consistent spacing unit between every stacked element (step ↔ label ↔
// "+" ↔ join ↔ next step). The rank gap fits a full branch chain
// (label + "+" + join) plus margins ; columns are spaced wide so lines clear
// the cards.
export const SEQUENCE_GAP = 40;
const COL_STEP = NODE_WIDTH + 180;
const ROW_STEP = NODE_HEIGHT + SEQUENCE_GAP * 4.5; // = 268, room for the chain

type Size = { w: number; h: number };
const SIZES: Record<string, Size> = {
  terminal: { w: 120, h: 36 },
  merge: { w: 36, h: 36 },
  trigger: { w: NODE_WIDTH, h: 64 },
};
function sizeOf(node: Node): Size {
  return SIZES[node.type ?? ""] ?? { w: NODE_WIDTH, h: NODE_HEIGHT };
}

export type SequenceLayout = {
  nodes: Node[];
  /** Orthogonal corner points per edge id (first/last ≈ the handles). */
  edgePoints: Record<string, { x: number; y: number }[]>;
  /** X of each branch's descent lane (preserves declared left→right order). */
  edgeLaneX: Record<string, number>;
};

export function useSequenceLayout(nodes: Node[], edges: Edge[]): SequenceLayout {
  return useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const out = new Map<string, Edge[]>();
    const indeg = new Map<string, number>();
    for (const n of nodes) {
      out.set(n.id, []);
      indeg.set(n.id, 0);
    }
    for (const e of edges) {
      if (!byId.has(e.source) || !byId.has(e.target)) continue;
      out.get(e.source)!.push(e);
      indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    }

    // --- ranks : longest path from the roots (Kahn topological pass) ---
    const rank = new Map<string, number>(nodes.map((n) => [n.id, 0]));
    const indegLeft = new Map(indeg);
    const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of out.get(id) ?? []) {
        rank.set(e.target, Math.max(rank.get(e.target) ?? 0, (rank.get(id) ?? 0) + 1));
        const left = (indegLeft.get(e.target) ?? 0) - 1;
        indegLeft.set(e.target, left);
        if (left === 0) queue.push(e.target);
      }
    }

    // --- column slots : tidy post-order DFS in authored order ---
    // Each outgoing edge gets a "lane". A branch with a private subtree uses
    // that subtree's column ; a branch converging into an already-placed node
    // (a merge) reserves a FRESH lane to its right — so a switch's branches
    // always keep their declared left→right order (Branche 1, 2, …, else),
    // even when later branches merge into an earlier one.
    const slot = new Map<string, number>();
    const edgeLane = new Map<string, { node: string } | { laneSlot: number }>();
    const seen = new Set<string>();
    let cursor = 0;
    const place = (id: string): number => {
      const existing = slot.get(id);
      if (existing != null) return existing;
      seen.add(id);
      const kidsE = (out.get(id) ?? []).filter((e) => byId.has(e.target));
      if (kidsE.length === 0) {
        const s = cursor++;
        slot.set(id, s);
        return s;
      }
      const lanes: number[] = [];
      for (const e of kidsE) {
        if (slot.has(e.target) || seen.has(e.target)) {
          // Already placed / in-progress (shared merge) → reserve a fresh lane.
          const laneSlot = cursor++;
          edgeLane.set(e.id, { laneSlot });
          lanes.push(laneSlot);
        } else {
          const ts = place(e.target);
          edgeLane.set(e.id, { node: e.target });
          lanes.push(ts);
        }
      }
      const s = (Math.min(...lanes) + Math.max(...lanes)) / 2;
      slot.set(id, s);
      return s;
    };
    for (const n of nodes) if ((indeg.get(n.id) ?? 0) === 0) place(n.id);
    for (const n of nodes) if (!slot.has(n.id)) slot.set(n.id, cursor++);

    // --- separate overlapping columns per rank ---
    // Tidy centring guarantees no overlap for trees, but a DAG (shared merge
    // nodes) can give two same-rank nodes fractional slots < 1 apart, so their
    // cards overlap. Enforce a minimum of one full column between neighbours.
    const byRank = new Map<number, string[]>();
    for (const n of nodes) {
      const r = rank.get(n.id) ?? 0;
      (byRank.get(r) ?? byRank.set(r, []).get(r)!).push(n.id);
    }
    for (const ids of byRank.values()) {
      ids.sort((a, b) => (slot.get(a)! - slot.get(b)!) || a.localeCompare(b));
      for (let i = 1; i < ids.length; i++) {
        const prev = slot.get(ids[i - 1]!)!;
        if (slot.get(ids[i]!)! < prev + 1) slot.set(ids[i]!, prev + 1);
      }
    }

    // --- positions ---
    const positioned = nodes.map((n) => {
      const s = sizeOf(n);
      const cx = (slot.get(n.id) ?? 0) * COL_STEP;
      const cy = (rank.get(n.id) ?? 0) * ROW_STEP;
      return { ...n, position: { x: cx - s.w / 2, y: cy } };
    });
    const posById = new Map(positioned.map((n) => [n.id, n]));

    // --- orthogonal edge routing (corners in inter-rank gaps) ---
    const edgePoints: SequenceLayout["edgePoints"] = {};
    for (const e of edges) {
      const u = posById.get(e.source);
      const v = posById.get(e.target);
      if (!u || !v) continue;
      const us = sizeOf(u);
      const vs = sizeOf(v);
      const ux = u.position.x + us.w / 2;
      const uyb = u.position.y + us.h; // bottom handle
      const vx = v.position.x + vs.w / 2;
      const vyt = v.position.y; // top handle
      const rd = (rank.get(e.target) ?? 0) - (rank.get(e.source) ?? 0);
      if (Math.abs(ux - vx) < 1) {
        edgePoints[e.id] = [
          { x: ux, y: uyb },
          { x: vx, y: vyt },
        ];
      } else {
        // Horizontal jog in a clear gap : just below the source for adjacent
        // ranks, just above the target for multi-rank (merge) edges — the
        // source column below a branch tail is empty, so the descent is clean.
        const jogY = rd <= 1 ? (uyb + vyt) / 2 : vyt - 24;
        edgePoints[e.id] = [
          { x: ux, y: uyb },
          { x: ux, y: jogY },
          { x: vx, y: jogY },
          { x: vx, y: vyt },
        ];
      }
    }

    // --- per-branch lane X (preserves declared order ; uses final slots) ---
    const edgeLaneX: SequenceLayout["edgeLaneX"] = {};
    for (const e of edges) {
      const rec = edgeLane.get(e.id);
      if (!rec) continue;
      const s = "node" in rec ? (slot.get(rec.node) ?? 0) : rec.laneSlot;
      edgeLaneX[e.id] = s * COL_STEP;
    }

    return { nodes: positioned, edgePoints, edgeLaneX };
  }, [nodes, edges]);
}
