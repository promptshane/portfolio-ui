import { useEffect, useRef, useState } from "react";

/** Matches the lightweight numeric tween used on the analysis page. */
export function useAnimatedNumber(value: number, duration = 180) {
  const [animated, setAnimated] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) return;

    let raf = 0;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();

    const step = (ts: number) => {
      const progress = Math.min(1, (ts - now) / duration);
      setAnimated(from + (to - from) * progress);
      if (progress < 1) {
        raf = requestAnimationFrame(step);
      } else {
        fromRef.current = to;
      }
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return animated;
}
