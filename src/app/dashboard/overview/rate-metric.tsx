'use client';

import { useEffect, useId, useRef, useState } from 'react';

// Adapted from the supplied GooeyTextHoverEffect demo: crossfade two SVG
// texts while Gaussian blur and an alpha threshold briefly merge their edges.
export default function RateMetric({ label, rate, count }: { label: string; rate: number; count: number }) {
  const id = useId().replaceAll(':', '');
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const group = useRef<SVGGElement>(null);
  const blur = useRef<SVGFEGaussianBlurElement>(null);
  const percent = useRef<SVGTextElement>(null);
  const absolute = useRef<SVGTextElement>(null);
  const progress = useRef(0);
  const active = hovered || focused || pinned;

  useEffect(() => {
    const target = active ? 1 : 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = progress.current;
    const started = performance.now();
    let frame = 0;
    function draw(now: number) {
      const elapsed = reduced ? 1 : Math.min((now - started) / 700, 1);
      const eased = elapsed * elapsed * (3 - 2 * elapsed);
      const value = start + (target - start) * eased;
      progress.current = value;
      percent.current?.setAttribute('opacity', String(1 - value));
      absolute.current?.setAttribute('opacity', String(value));
      blur.current?.setAttribute('stdDeviation', String(Math.sin(value * Math.PI) * 2));
      if (group.current) group.current.style.filter = reduced || elapsed === 1 ? 'none' : `url(#${id})`;
      if (elapsed < 1) frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [active, id]);

  return <div className="rate-metric" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
    <span className="muted">{label}</span>
    <button type="button" className="rate-metric-value" onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setPinned(false); }} onClick={() => setPinned(value => !value)} aria-label={`${label}: ${rate} percent, ${count} applications`}>
      <svg width="160" height="46" viewBox="0 0 160 46" aria-hidden="true">
        <defs><filter id={id} x="-20%" y="-40%" width="140%" height="180%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0" result="blur" ref={blur} />
          <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 15 -8" result="goo" />
          <feComposite in="SourceGraphic" in2="goo" operator="atop" />
        </filter></defs>
        <g ref={group}><text ref={percent} x="2" y="34">{rate}%</text><text ref={absolute} x="2" y="34" opacity="0">{count}</text></g>
      </svg>
    </button>
  </div>;
}
