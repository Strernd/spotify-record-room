import { parseRetryAfterSeconds } from '../lib/spotify-rate-limit.ts';

export const EXTERNAL_PLAYER_STATE_POLL_INTERVAL_MS = 15_000;
export const DEVICE_REFRESH_INTERVAL_MS = 60_000;
export const DEFAULT_RATE_LIMIT_BACKOFF_MS = 60_000;

export class PollCoordinator {
  private inFlight: Promise<number> | null = null;
  private notBefore = 0;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  remainingDelayMs(): number {
    return Math.max(0, this.notBefore - this.now());
  }

  request(poll: () => Promise<number>, fallbackDelayMs: number): Promise<number> {
    if (this.inFlight) return this.inFlight;

    const request = poll()
      .catch(() => fallbackDelayMs)
      .then((requestedDelay) => {
        const nextDelay = Number.isFinite(requestedDelay) && requestedDelay >= 0
          ? requestedDelay
          : fallbackDelayMs;
        this.notBefore = Math.max(this.notBefore, this.now() + nextDelay);
        return nextDelay;
      })
      .finally(() => {
        if (this.inFlight === request) this.inFlight = null;
      });
    this.inFlight = request;
    return request;
  }
}

export function shouldPollPlayerState({
  hidden,
  localDeviceId,
  outputDeviceId,
  pageVisible,
}: {
  hidden: boolean;
  localDeviceId: string | null;
  outputDeviceId: string | null;
  pageVisible: boolean;
}): boolean {
  return Boolean(
    !hidden &&
    pageVisible &&
    outputDeviceId &&
    (!localDeviceId || outputDeviceId !== localDeviceId),
  );
}

export function spotifyPollDelayMs(
  status: number,
  retryAfter: string | null,
  normalIntervalMs = EXTERNAL_PLAYER_STATE_POLL_INTERVAL_MS,
): number {
  if (status !== 429) return normalIntervalMs;
  const retryAfterSeconds = parseRetryAfterSeconds(retryAfter);
  if (retryAfterSeconds === null) return Math.max(normalIntervalMs, DEFAULT_RATE_LIMIT_BACKOFF_MS);
  return Math.max(
    normalIntervalMs,
    retryAfterSeconds * 1000,
  );
}
