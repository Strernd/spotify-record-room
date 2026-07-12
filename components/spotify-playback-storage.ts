const PLAYBACK_STORAGE_KEY = 'spotify-cd-shelves.playback.v1';

export type SavedSpotifyPlayback = {
  albumId: string;
  paused: boolean;
  positionMs: number;
  trackId: string;
  updatedAt: number;
};

function isSavedSpotifyPlayback(value: unknown): value is SavedSpotifyPlayback {
  if (typeof value !== 'object' || value === null) return false;
  const playback = value as SavedSpotifyPlayback;
  return (
    typeof playback.albumId === 'string' &&
    typeof playback.trackId === 'string' &&
    typeof playback.paused === 'boolean' &&
    typeof playback.positionMs === 'number' &&
    Number.isFinite(playback.positionMs) &&
    playback.positionMs >= 0 &&
    typeof playback.updatedAt === 'number' &&
    Number.isFinite(playback.updatedAt)
  );
}

export function readSavedSpotifyPlayback(): SavedSpotifyPlayback | null {
  try {
    const value = window.localStorage.getItem(PLAYBACK_STORAGE_KEY);
    if (!value) return null;
    const parsed: unknown = JSON.parse(value);
    return isSavedSpotifyPlayback(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSpotifyPlayback(playback: SavedSpotifyPlayback): void {
  try {
    window.localStorage.setItem(PLAYBACK_STORAGE_KEY, JSON.stringify(playback));
  } catch {
    // Playback can continue when storage is unavailable or full.
  }
}

export function clearSavedSpotifyPlayback(albumId?: string): void {
  try {
    if (albumId && readSavedSpotifyPlayback()?.albumId !== albumId) return;
    window.localStorage.removeItem(PLAYBACK_STORAGE_KEY);
  } catch {
    // Nothing else needs to happen when storage is unavailable.
  }
}
