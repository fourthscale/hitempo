/**
 * React Flow's `fitView` centers the diagram both horizontally AND vertically.
 * On a long sequence (5+ steps stacked top-to-bottom) this hides BOTH the
 * trigger and the final step, leaving the user staring at the middle of the
 * flow with no idea where the sequence starts.
 *
 * This helper runs AFTER `fitView`, keeps the same horizontal centering and
 * zoom, but shifts the viewport so the topmost node lands a small padding
 * (`PAD_TOP_PX`) below the visible top edge. Reading naturally starts from
 * the trigger again ; scrolling down reveals the rest.
 *
 * Use as the `onInit` prop on a `<ReactFlow fitView ...>`. Wrapped in
 * `requestAnimationFrame` so it runs after React Flow's own initial fit.
 *
 * Structural typing on the instance (not the full `ReactFlowInstance` type)
 * so the helper works regardless of the caller's custom Node/Edge generics
 * — we only need three methods.
 */
const PAD_TOP_PX = 40;

type FlowInstanceLite = {
  getNodes: () => Array<{ position: { x: number; y: number } }>;
  getViewport: () => { x: number; y: number; zoom: number };
  setViewport: (vp: { x: number; y: number; zoom: number }) => void;
};

export function anchorTopOnInit(instance: FlowInstanceLite): void {
  requestAnimationFrame(() => {
    const nodes = instance.getNodes();
    if (nodes.length === 0) return;
    const topY = Math.min(...nodes.map((n) => n.position.y));
    const { x, zoom } = instance.getViewport();
    instance.setViewport({ x, y: PAD_TOP_PX - topY * zoom, zoom });
  });
}
