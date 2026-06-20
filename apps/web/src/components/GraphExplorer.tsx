import type { SVGProps } from 'react';

type GraphNode = {
  id: string;
  label: string;
  type: string;
};

type GraphEdge = {
  id?: string;
  relationshipType: string;
  fromEntityId: string;
  toEntityId: string;
};

type PlacedNode = GraphNode & { x: number; y: number };

type GraphExplorerProps = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

const markerProps: SVGProps<SVGMarkerElement> = {
  id: 'arrowhead',
  markerWidth: 10,
  markerHeight: 7,
  refX: 9,
  refY: 3.5,
  orient: 'auto',
};

export default function GraphExplorer({ nodes, edges }: GraphExplorerProps) {
  if (nodes.length === 0) {
    return <p className="muted">Graph data unavailable. Run the services and seed the governance map.</p>;
  }

  const width = 920;
  const height = 560;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.36;
  const placed: PlacedNode[] = nodes.map((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(nodes.length, 1) - Math.PI / 2;
    return {
      ...node,
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    };
  });
  const byId = new Map(placed.map((node) => [node.id, node]));
  const visibleEdges = edges
    .map((edge) => ({ edge, from: byId.get(edge.fromEntityId), to: byId.get(edge.toEntityId) }))
    .filter((item): item is { edge: GraphEdge; from: PlacedNode; to: PlacedNode } => Boolean(item.from && item.to));

  return (
    <div className="graph-explorer" aria-label="Governance relationship graph">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="graph-title graph-desc">
        <title id="graph-title">Typed governance relationship graph</title>
        <desc id="graph-desc">Entities placed in a static circle with arrows labelled by relationship type.</desc>
        <defs>
          <marker {...markerProps}>
            <path d="M0,0 L10,3.5 L0,7 Z" fill="currentColor" />
          </marker>
        </defs>
        <g className="graph-edges">
          {visibleEdges.map(({ edge, from, to }, index) => {
            const midX = (from.x + to.x) / 2;
            const midY = (from.y + to.y) / 2;
            return (
              <g key={edge.id ?? `${edge.fromEntityId}-${edge.toEntityId}-${index}`}>
                <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} markerEnd="url(#arrowhead)" />
                <text x={midX} y={midY} textAnchor="middle">
                  {edge.relationshipType.replaceAll('_', ' ')}
                </text>
              </g>
            );
          })}
        </g>
        <g className="graph-nodes">
          {placed.map((node) => (
            <g key={node.id} transform={`translate(${node.x} ${node.y})`}>
              <circle r="48" />
              <text y="-5" textAnchor="middle" className="graph-node-label">
                {node.label.length > 18 ? `${node.label.slice(0, 16)}…` : node.label}
              </text>
              <text y="16" textAnchor="middle" className="graph-node-type">
                {node.type}
              </text>
            </g>
          ))}
        </g>
      </svg>
      <style>{`
        .graph-explorer {
          overflow-x: auto;
        }
        .graph-explorer svg {
          min-width: 720px;
          color: var(--color-primary);
        }
        .graph-edges line {
          stroke: rgba(56, 189, 248, 0.58);
          stroke-width: 1.5;
        }
        .graph-edges text {
          fill: var(--color-muted);
          font-size: 10px;
          paint-order: stroke;
          stroke: var(--color-bg);
          stroke-width: 4px;
        }
        .graph-nodes circle {
          fill: var(--color-surface);
          stroke: var(--color-accent);
          stroke-width: 2px;
        }
        .graph-node-label {
          fill: var(--color-text);
          font-size: 12px;
          font-weight: 700;
        }
        .graph-node-type {
          fill: var(--color-muted);
          font-size: 10px;
          text-transform: uppercase;
        }
        @media (prefers-reduced-motion: reduce) {
          .graph-explorer *, .graph-explorer *::before, .graph-explorer *::after {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>
    </div>
  );
}
