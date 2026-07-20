import { spotifyRateLimitMessage } from '../lib/spotify-rate-limit.ts';

export async function spotifyPlayerResponseError(
  response: Response,
  fallback: string,
): Promise<Error> {
  if (response.status === 429) {
    return new Error(spotifyRateLimitMessage(response.headers.get('Retry-After')));
  }
  try {
    const data = (await response.json()) as { error?: string };
    return new Error(data.error || fallback);
  } catch {
    return new Error(fallback);
  }
}
