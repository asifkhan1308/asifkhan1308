import { useEffect, useRef } from 'react';
import { useV1 } from '../store';

/**
 * Single authoritative playback clock: when isPlaying toggles true, this
 * drives currentTime forward via requestAnimationFrame. Scrubbing / Space
 * toggle this flag; every component derives time from the store, not its
 * own clock.
 */
export function usePlaybackClock() {
  const isPlaying = useV1((s) => s.isPlaying);
  const duration = useV1((s) => s.project.composition.duration);
  const setCurrentTime = useV1((s) => s.setCurrentTime);
  const setIsPlaying = useV1((s) => s.setIsPlaying);
  const rafRef = useRef<number | undefined>(undefined);
  const lastRef = useRef<number>(0);

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    lastRef.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastRef.current) / 1000;
      lastRef.current = now;
      const next = useV1.getState().currentTime + dt;
      if (next >= duration) {
        setCurrentTime(0);
      } else {
        setCurrentTime(next);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, duration, setCurrentTime, setIsPlaying]);
}
