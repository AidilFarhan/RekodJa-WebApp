import type { ReactNode } from 'react';

type CircuitNode = { id: string; x: number; y: number; label: string; icon: ReactNode };
type CircuitConnection = { from: string; to: string; animated?: boolean };

export function CircuitBoard({ nodes, connections, width, height }: { nodes: CircuitNode[]; connections: CircuitConnection[]; width: number; height: number }) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const canvasWidth = Math.max(width, ...nodes.map((node) => node.x + 80));

  return <section className="circuit-flow circuit-board" aria-label="Job application data flow">
    <svg viewBox={`0 0 ${canvasWidth} ${height}`} style={{ maxWidth: `${width}px` }} role="img" aria-hidden="true">
      {connections.map((connection) => {
        const from = byId.get(connection.from);
        const to = byId.get(connection.to);
        if (!from || !to) return null;
        const midX = (from.x + to.x) / 2;
        const path = `M ${from.x} ${from.y} Q ${midX} ${from.y} ${to.x} ${to.y}`;
        return <g key={`${connection.from}-${connection.to}`}>
          <path className="circuit-line" d={path} />
          {connection.animated && <path className="circuit-pulse" d={path} />}
        </g>;
      })}
      {nodes.map((node) => <g key={node.id} className="circuit-node" transform={`translate(${node.x} ${node.y})`}>
        <circle r="23" />
        <foreignObject x="-10" y="-10" width="20" height="20"><div className="circuit-node-icon">{node.icon}</div></foreignObject>
        <text y="43">{node.label}</text>
      </g>)}
    </svg>
  </section>;
}
