export function parseRetryAfterSeconds(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.ceil(seconds);
}
