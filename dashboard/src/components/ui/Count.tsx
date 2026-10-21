import React, { useEffect, useRef } from 'react';
import { animate, useReducedMotion } from 'framer-motion';
import { useSettings } from '../../lib/settings';

/** Update text directly during a tween so live counters don't re-render React every frame. */
export const Count: React.FC<{ value: number }> = ({ value }) => {
  const element = useRef<HTMLSpanElement>(null);
  const from = useRef(0);
  const lastUpdate = useRef(-Infinity);
  const { settings } = useSettings();
  const reduced = useReducedMotion();
  useEffect(() => {
    const now = performance.now();
    const busy = now - lastUpdate.current < 900;
    lastUpdate.current = now;
    if (busy || settings.reduceMotion || reduced) {
      from.current = value;
      if (element.current) element.current.textContent = String(value);
      return;
    }
    const controls = animate(from.current, value, {
      duration: 0.9,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        from.current = v;
        if (element.current) element.current.textContent = String(Math.round(v));
      },
    });
    return () => controls.stop();
  }, [value, settings.reduceMotion, reduced]);
  return <span ref={element} className="tabular" />;
};
