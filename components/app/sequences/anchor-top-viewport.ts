import { useEffect, useRef } from "react";

/**
 * React Flow's `fitView` centers the diagram both horizontally AND vertically.
 * On a long sequence (5+ steps stacked top-to-bottom) this hides BOTH the
 * trigger and the final step, leaving the user staring at the middle of the
 * flow with no idea where the sequence starts.
 *
 * The hook keeps the same horizontal centering / zoom from `fitView`, but
 * shifts the viewport so the topmost node lands a small padding
 * (`PAD_TOP_PX`) below the visible top edge.
 *
 * ## Why a hook (not just `onInit`)
 *
 * Initially we wired this as `onInit={anchorTopOnInit}` on the React Flow
 * component. That works on the first mount (hard refresh) but breaks on
 * Next.js client-side navigation : `onInit` fires only once when the
 * React Flow *instance* is created, and React's reconciler sometimes
 * preserves the instance across route changes (or runs onInit BEFORE
 * `fitView` has fully settled, so fitView's animation overrides our
 * anchor). The user sees the diagram centered until they hard-refresh.
 *
 * As a hook driven by `useEffect` we :
 *  1. Re-run on every mount AND every nodes-identity change (the deps
 *     array carries `nodes`), so client-side navigation always re-anchors.
 *  2. Capture the React Flow instance via the standard `onInit` callback
 *     and stash it in a ref — no `<ReactFlowProvider>` wrapping required.
 *  3. Use a small `setTimeout` (50 ms) instead of a single
 *     `requestAnimationFrame` so we run AFTER React Flow's own fitView
 *     animation has settled — a single RAF was racing the fit on some
 *     re-renders.
 */
const PAD_TOP_PX = 40;
const POST_FIT_DELAY_MS = 50;

type FlowInstanceLite = {
  getNodes: () => Array<{ position: { x: number; y: number } }>;
  getViewport: () => { x: number; y: number; zoom: number };
  setViewport: (vp: { x: number; y: number; zoom: number }) => void;
};

/**
 * Use it as :
 * ```tsx
 * const { onInit } = useAnchorTopViewport(nodes);
 * return <ReactFlow ... onInit={onInit} fitView />;
 * ```
 * Pass the same `nodes` array you give to `<ReactFlow nodes={nodes}>`.
 *
 * Anchors ONCE per mount, the moment React Flow has produced a non-empty
 * relayouted node set. Subsequent node changes — editing a step's title,
 * inserting/removing a node, etc. — do NOT re-anchor : the user is
 * working on a specific spot in the diagram and a sudden jump back to
 * the top would be jarring. Client-side navigation between sequences
 * unmounts the component, so the `hasAnchored` ref resets and the new
 * mount anchors fresh — which is what the original brief asked for.
 */
export function useAnchorTopViewport<N extends { position: { x: number; y: number } }>(
  nodes: ReadonlyArray<N>,
) {
  const instanceRef = useRef<FlowInstanceLite | null>(null);
  const hasAnchoredRef = useRef(false);

  function anchorOnce(instance: FlowInstanceLite): () => void {
    const handle = setTimeout(() => {
      if (hasAnchoredRef.current) return;
      const live = instance.getNodes();
      if (live.length === 0) return;
      const topY = Math.min(...live.map((n) => n.position.y));
      const { x, zoom } = instance.getViewport();
      instance.setViewport({ x, y: PAD_TOP_PX - topY * zoom, zoom });
      hasAnchoredRef.current = true;
    }, POST_FIT_DELAY_MS);
    return () => clearTimeout(handle);
  }

  // The first effect run usually has `instanceRef.current === null`
  // because React Flow's `onInit` fires AFTER the first render's effects.
  // We re-run on every nodes change as a fallback : if `onInit` somehow
  // already populated the ref (cached instance across reconciliation),
  // we anchor here ; otherwise we wait for onInit to do it.
  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    if (hasAnchoredRef.current) return;
    return anchorOnce(instance);
  }, [nodes]);

  return {
    onInit(instance: FlowInstanceLite): void {
      instanceRef.current = instance;
      if (hasAnchoredRef.current) return;
      anchorOnce(instance);
    },
  };
}
