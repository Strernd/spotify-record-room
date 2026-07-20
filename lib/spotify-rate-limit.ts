export function parseRetryAfterSeconds(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.ceil(seconds);
}

export function spotifyRateLimitMessage(retryAfter: string | null): string {
  const seconds = parseRetryAfterSeconds(retryAfter);
  if (seconds === null) {
    return 'Spotify is rate-limiting this app. Please try again later.';
  }
  if (seconds < 60) {
    return `Spotify is rate-limiting this app. Try again in about ${seconds} seconds.`;
  }
  if (seconds < 3600) {
    return `Spotify is rate-limiting this app. Try again in about ${Math.ceil(seconds / 60)} minutes.`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  const duration = minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `Spotify is rate-limiting this app. Try again in about ${duration}.`;
}
