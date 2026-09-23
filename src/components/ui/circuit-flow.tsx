const nodes = [
  { label: 'Job Website', x: 72 },
  { label: 'RekodJa: Extension', x: 286 },
  { label: 'Spreadsheet', x: 510 },
  { label: 'RekodJa: Web App', x: 734 },
];

export function CircuitFlow() {
  return <section className="circuit-flow" aria-label="Job application data flow: Job Website, RekodJa Extension, Spreadsheet, and RekodJa Web App.">
    <svg viewBox="0 0 806 156" role="img" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <path className="circuit-line" d="M72 76H286H510H734M178 76V30H230M398 76V122H450M622 76V30H674" />
      <path className="circuit-pulse" d="M72 76H286H510H734" />
      <circle className="circuit-joint" cx="178" cy="76" r="4" /><circle className="circuit-joint" cx="398" cy="76" r="4" /><circle className="circuit-joint" cx="622" cy="76" r="4" />
      {nodes.map((node) => <g key={node.label} className="circuit-node" transform={`translate(${node.x} 76)`}>
        <circle r="19" />
        <circle className="circuit-node-core" r="5" />
        <text y="42">{node.label}</text>
      </g>)}
    </svg>
  </section>;
}
