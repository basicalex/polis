import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, SVGProps } from 'react';

type GraphNode = {
  id: string;
  label: string;
  type: string;
  reviewState?: string;
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
  jurisdiction?: string;
};

const markerProps: SVGProps<SVGMarkerElement> = {
  id: 'arrowhead',
  markerWidth: 10,
  markerHeight: 7,
  refX: 9,
  refY: 3.5,
  orient: 'auto',
};

const ENTITY_ROUTES: Record<string, string> = {
  institution: 'institutions',
  process: 'processes',
  role: 'roles',
};

function nodeHref(node: GraphNode, jurisdiction?: string): string | null {
  if (!jurisdiction) return null;
  const segment = ENTITY_ROUTES[node.type];
  if (!segment) return null;
  return `/governance/${encodeURIComponent(jurisdiction)}/${segment}/${encodeURIComponent(node.id)}`;
}

function reviewTone(reviewState?: string): string {
  switch (reviewState) {
    case 'approved':
      return 'valid';
    case 'rejected':
      return 'invalid';
    case 'under_review':
    case 'draft':
      return 'warning';
    default:
      return 'unknown';
  }
}

export default function GraphExplorer({ nodes, edges, jurisdiction }: GraphExplorerProps) {
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<ReadonlySet<string>>(new Set());
  const [showTable, setShowTable] = useState(false);
  const nodeRefs = useRef(new Map<string, SVGGElement>());

  const relationshipTypes = useMemo(
    () => Array.from(new Set(edges.map((edge) => edge.relationshipType))).sort(),
    [edges],
  );

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
    .filter((edge) => !hiddenTypes.has(edge.relationshipType))
    .map((edge) => ({ edge, from: byId.get(edge.fromEntityId), to: byId.get(edge.toEntityId) }))
    .filter((item): item is { edge: GraphEdge; from: PlacedNode; to: PlacedNode } => Boolean(item.from && item.to));

  const toggleType = (type: string) => {
    setHiddenTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const focusNodeAt = (index: number) => {
    const node = placed[(index + placed.length) % placed.length];
    if (!node) return;
    nodeRefs.current.get(node.id)?.focus();
  };

  const onNodeKeyDown = (event: KeyboardEvent<SVGGElement>, node: PlacedNode, index: number) => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        focusNodeAt(index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        focusNodeAt(index - 1);
        break;
      case 'Enter':
      case ' ': {
        const href = nodeHref(node, jurisdiction);
        if (href) {
          event.preventDefault();
          window.location.href = href;
        }
        break;
      }
      default:
        break;
    }
  };

  const openNode = (node: PlacedNode) => {
    const href = nodeHref(node, jurisdiction);
    if (href) window.location.href = href;
  };

  return (
    <div className="graph-explorer" aria-label="Governance relationship graph">
      <div className="graph-toolbar">
        <fieldset className="graph-legend">
          <legend>Relationship types</legend>
          {relationshipTypes.map((type) => (
            <label key={type} className="graph-legend-item">
              <input
                type="checkbox"
                checked={!hiddenTypes.has(type)}
                onChange={() => toggleType(type)}
              />
              <span>{type.replaceAll('_', ' ')}</span>
            </label>
          ))}
        </fieldset>
        <button
          type="button"
          className="graph-view-toggle"
          aria-pressed={showTable}
          onClick={() => setShowTable((current) => !current)}
        >
          {showTable ? 'Show diagram' : 'Show as table'}
        </button>
      </div>

      {showTable ? (
        <table className="data-table graph-table">
          <caption className="visually-hidden">Governance relationships as a table</caption>
          <thead>
            <tr>
              <th scope="col">From</th>
              <th scope="col">Relationship</th>
              <th scope="col">To</th>
            </tr>
          </thead>
          <tbody>
            {visibleEdges.map(({ edge, from, to }, index) => (
              <tr key={edge.id ?? `${edge.fromEntityId}-${edge.toEntityId}-${index}`}>
                <td>
                  {from.label} <span className="muted">({from.type})</span>
                </td>
                <td>{edge.relationshipType.replaceAll('_', ' ')}</td>
                <td>
                  {to.label} <span className="muted">({to.type})</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="graph-title graph-desc">
          <title id="graph-title">Typed governance relationship graph</title>
          <desc id="graph-desc">
            Entities placed in a static circle with arrows labelled by relationship type. Use Tab to
            reach the graph, arrow keys to move between entities, Enter to open an entity page. The
            same data is available as a table via the toggle above.
          </desc>
          <defs>
            <marker {...markerProps}>
              <path d="M0,0 L10,3.5 L0,7 Z" fill="currentColor" />
            </marker>
          </defs>
          <g className="graph-edges">
            {visibleEdges.map(({ edge, from, to }, index) => {
              const midX = (from.x + to.x) / 2;
              const midY = (from.y + to.y) / 2;
              const isActive =
                activeNodeId !== null && (from.id === activeNodeId || to.id === activeNodeId);
              const isDimmed = activeNodeId !== null && !isActive;
              return (
                <g
                  key={edge.id ?? `${edge.fromEntityId}-${edge.toEntityId}-${index}`}
                  className={isActive ? 'graph-edge is-active' : isDimmed ? 'graph-edge is-dimmed' : 'graph-edge'}
                >
                  <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} markerEnd="url(#arrowhead)" />
                  <text x={midX} y={midY} textAnchor="middle">
                    {edge.relationshipType.replaceAll('_', ' ')}
                  </text>
                </g>
              );
            })}
          </g>
          <g className="graph-nodes">
            {placed.map((node, index) => {
              const href = nodeHref(node, jurisdiction);
              return (
                <g
                  key={node.id}
                  ref={(element) => {
                    if (element) nodeRefs.current.set(node.id, element);
                    else nodeRefs.current.delete(node.id);
                  }}
                  transform={`translate(${node.x} ${node.y})`}
                  className={activeNodeId === node.id ? 'graph-node is-active' : 'graph-node'}
                  data-tone={reviewTone(node.reviewState)}
                  data-reviewed={node.reviewState === 'approved' ? 'true' : 'false'}
                  tabIndex={index === 0 ? 0 : -1}
                  role={href ? 'link' : 'group'}
                  aria-label={`${node.label}, ${node.type}${node.reviewState ? `, review state ${node.reviewState.replaceAll('_', ' ')}` : ''}`}
                  onMouseEnter={() => setActiveNodeId(node.id)}
                  onMouseLeave={() => setActiveNodeId((current) => (current === node.id ? null : current))}
                  onFocus={() => setActiveNodeId(node.id)}
                  onBlur={() => setActiveNodeId((current) => (current === node.id ? null : current))}
                  onKeyDown={(event) => onNodeKeyDown(event, node, index)}
                  onClick={() => openNode(node)}
                  style={href ? { cursor: 'pointer' } : undefined}
                >
                  <circle r="48" />
                  <text y="-5" textAnchor="middle" className="graph-node-label">
                    {node.label.length > 18 ? `${node.label.slice(0, 16)}…` : node.label}
                  </text>
                  <text y="16" textAnchor="middle" className="graph-node-type">
                    {node.type}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      )}
      <style>{`
        .graph-explorer {
          overflow-x: auto;
        }
        .graph-explorer svg {
          min-width: 720px;
          color: var(--polis-primary);
        }
        .graph-toolbar {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 1rem;
          margin-bottom: 0.75rem;
          flex-wrap: wrap;
        }
        .graph-legend {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem 1rem;
          border: 1px solid var(--polis-border);
          border-radius: var(--radius-md, 12px);
          padding: 0.5rem 0.75rem;
        }
        .graph-legend legend {
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--polis-muted);
          padding: 0 0.25rem;
        }
        .graph-legend-item {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          font-size: 0.85rem;
        }
        .graph-view-toggle {
          flex-shrink: 0;
        }
        .graph-edges line {
          stroke: var(--polis-accent);
          stroke-opacity: 0.55;
          stroke-width: 1.5;
        }
        .graph-edge.is-active line {
          stroke-opacity: 1;
          stroke-width: 2.5;
        }
        .graph-edge.is-dimmed {
          opacity: 0.25;
        }
        .graph-edges text {
          fill: var(--polis-muted);
          font-size: 10px;
          paint-order: stroke;
          stroke: var(--polis-bg);
          stroke-width: 4px;
        }
        .graph-node circle {
          fill: var(--polis-surface);
          stroke: var(--polis-accent);
          stroke-width: 2px;
        }
        .graph-node[data-reviewed='false'] circle {
          stroke-dasharray: 6 4;
        }
        .graph-node[data-tone='valid'] circle { stroke: var(--trust-valid-border); }
        .graph-node[data-tone='warning'] circle { stroke: var(--trust-warning-border); }
        .graph-node[data-tone='invalid'] circle { stroke: var(--trust-invalid-border); }
        .graph-node.is-active circle,
        .graph-node:focus circle {
          stroke-width: 4px;
        }
        .graph-node:focus {
          outline: none;
        }
        .graph-node:focus-visible circle {
          stroke: var(--polis-text);
        }
        .graph-node-label {
          fill: var(--polis-text);
          font-size: 12px;
          font-weight: 700;
        }
        .graph-node-type {
          fill: var(--polis-muted);
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
