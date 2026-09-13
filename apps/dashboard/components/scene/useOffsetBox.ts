'use client';

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

export interface OffsetBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Where an absolutely positioned label sits inside its scene, and how big it is, as the browser laid
 * it out (before any CSS transform). Labels placed from data move with every render, which a resize
 * observer never hears about, so the box is read after each render and only stored when it changes.
 */
export function useOffsetBox<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const [box, setBox] = useState<OffsetBox | null>(null);
  const ref = useCallback((node: T | null) => setElement(node), []);

  const measure = useCallback(() => {
    if (!element) {
      setBox((current) => (current === null ? current : null));
      return;
    }
    const next = { left: element.offsetLeft, top: element.offsetTop, width: element.offsetWidth, height: element.offsetHeight };
    setBox((current) =>
      current && current.left === next.left && current.top === next.top && current.width === next.width && current.height === next.height ? current : next,
    );
  }, [element]);

  useLayoutEffect(measure);

  useEffect(() => {
    if (!element) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, measure]);

  return { ref, box };
}
