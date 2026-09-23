'use client';

import { useEffect, useState } from 'react';

type TextMorphProps = {
  words: string[];
  interval?: number;
  morphDuration?: number;
  className?: string;
};

export function TextMorph({ words, interval = 2400, morphDuration = 680, className }: TextMorphProps) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (words.length < 2) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % words.length), interval);
    return () => window.clearInterval(timer);
  }, [interval, words.length]);

  return <span className={`text-morph ${className ?? ''}`} style={{ '--morph-duration': `${morphDuration}ms` } as React.CSSProperties} aria-live="polite">
    <span key={words[index]}>{words[index]}</span>
  </span>;
}
