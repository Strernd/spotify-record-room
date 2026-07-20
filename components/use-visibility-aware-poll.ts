'use client';

import { useEffect, useRef } from 'react';

import { PollCoordinator } from './spotify-player-polling';

export function useVisibilityAwarePoll({
  enabled,
  fallbackDelayMs,
  poll,
}: {
  enabled: boolean;
  fallbackDelayMs: number;
  poll: () => Promise<number>;
}): void {
  const coordinatorRef = useRef<PollCoordinator | null>(null);
  if (coordinatorRef.current === null) coordinatorRef.current = new PollCoordinator();

  useEffect(() => {
    if (!enabled) return;
    const coordinator = coordinatorRef.current;
    if (!coordinator) return;
    let cancelled = false;
    let timer: number | null = null;

    const schedule = (delayMs: number) => {
      if (cancelled) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        run();
      }, delayMs);
    };
    const run = () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      const remainingDelay = coordinator.remainingDelayMs();
      if (remainingDelay > 0) {
        schedule(remainingDelay);
        return;
      }

      const request = coordinator.request(poll, fallbackDelayMs);
      void request
        .finally(() => {
          if (!cancelled && document.visibilityState === 'visible') {
            schedule(coordinator.remainingDelayMs());
          }
        });
    };
    const handleVisibilityChange = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (document.visibilityState === 'visible') run();
    };

    run();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, fallbackDelayMs, poll]);
}
