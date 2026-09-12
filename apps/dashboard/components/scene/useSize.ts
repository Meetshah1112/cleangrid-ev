'use client';

import { useCallback, useEffect, useState } from 'react';

export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * The rendered size of an element, so a scene can be drawn in real pixels.
 *
 * Drawing at the element's true size, rather than scaling one fixed viewBox, is what keeps a wind
 * turbine a wind turbine at every width: a stretched SVG would squash it on a phone and splay it
 * on a wide monitor. It is also what lets the HTML labels above the drawing line up with it.
 *
 * Starts from the same default on the server and in the browser, so the first render hydrates
 * cleanly, and measures once mounted. The ref is a callback so an element that only appears later,
 * such as a chart that waits for its data, is measured when it does rather than never.
 */
export function useSize<T extends HTMLElement>(fallback: Size) {
  const [element, setElement] = useState<T | null>(null);
  const [size, setSize] = useState<Size>(fallback);
  const ref = useCallback((node: T | null) => setElement(node), []);

  useEffect(() => {
    if (!element) return undefined;
    const measure = (): void => {
      const box = element.getBoundingClientRect();
      const width = Math.max(1, Math.round(box.width));
      const height = Math.max(1, Math.round(box.height));
      setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return { ref, size };
}
