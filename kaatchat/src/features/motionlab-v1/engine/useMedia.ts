import { useEffect, useRef, useState } from 'react';
import type { Asset } from '../types';

/**
 * Resolve each asset's url into a decoded HTMLImageElement or HTMLVideoElement
 * the compose pass can draw. Returns a Map keyed by asset.id. Rebuilds when
 * the asset list changes.
 */
export function useMediaElements(assets: Asset[]): Map<string, HTMLImageElement | HTMLVideoElement> {
  const [map, setMap] = useState<Map<string, HTMLImageElement | HTMLVideoElement>>(() => new Map());
  const assetRef = useRef<string>('');

  useEffect(() => {
    const key = assets.map((a) => `${a.id}:${a.url}`).join('|');
    if (key === assetRef.current) return;
    assetRef.current = key;

    let cancelled = false;
    const next = new Map<string, HTMLImageElement | HTMLVideoElement>();
    const pending: Promise<void>[] = [];

    for (const a of assets) {
      if (a.kind === 'image') {
        pending.push(
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => {
              next.set(a.id, img);
              resolve();
            };
            img.onerror = () => resolve();
            img.src = a.url;
          }),
        );
      } else {
        pending.push(
          new Promise<void>((resolve) => {
            const v = document.createElement('video');
            v.muted = true;
            v.playsInline = true;
            // Chromium doesn't present a frame for an off-DOM video until it
            // has been seeked once, so drawImage() right after loadeddata
            // paints nothing. One tiny seek makes the first frame drawable.
            v.onloadeddata = () => {
              v.onloadeddata = null;
              const ready = () => { v.removeEventListener('seeked', ready); next.set(a.id, v); resolve(); };
              v.addEventListener('seeked', ready);
              v.currentTime = 0.001;
            };
            v.onerror = () => resolve();
            v.src = a.url;
          }),
        );
      }
    }

    void Promise.all(pending).then(() => {
      if (!cancelled) setMap(new Map(next));
    });
    return () => {
      cancelled = true;
    };
  }, [assets]);

  return map;
}
