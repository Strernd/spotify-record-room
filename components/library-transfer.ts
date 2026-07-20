import type { AlbumTrack, LibraryAlbum, StoredLibraryAlbum } from './cd-library-types';

const EXPORT_FORMAT = 'spotify-cd-shelves-library';
const EXPORT_VERSION = 1;

type LibraryExport = {
  albums: StoredLibraryAlbum[];
  exportedAt: string;
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isAlbumTrack(value: unknown): value is AlbumTrack {
  if (typeof value !== 'object' || value === null) return false;
  const track = value as AlbumTrack;
  return (
    typeof track.id === 'string' &&
    typeof track.name === 'string' &&
    typeof track.durationMs === 'number' &&
    Number.isFinite(track.durationMs) &&
    track.durationMs >= 0 &&
    typeof track.trackNumber === 'number' &&
    Number.isInteger(track.trackNumber) &&
    track.trackNumber > 0 &&
    typeof track.discNumber === 'number' &&
    Number.isInteger(track.discNumber) &&
    track.discNumber > 0 &&
    typeof track.spotifyUrl === 'string'
  );
}

export function isStoredLibraryAlbum(value: unknown): value is StoredLibraryAlbum {
  if (typeof value !== 'object' || value === null) return false;
  const album = value as LibraryAlbum;
  return (
    typeof album.id === 'string' &&
    typeof album.name === 'string' &&
    isStringArray(album.artists) &&
    typeof album.imageUrl === 'string' &&
    typeof album.spotifyUrl === 'string' &&
    typeof album.releaseDate === 'string' &&
    typeof album.totalTracks === 'number' &&
    Number.isInteger(album.totalTracks) &&
    album.totalTracks >= 0 &&
    typeof album.spineColor === 'string' &&
    Array.isArray(album.tracks) &&
    album.tracks.every(isAlbumTrack) &&
    (album.addedAt === undefined || typeof album.addedAt === 'string') &&
    (album.label === undefined || typeof album.label === 'string') &&
    (album.copyrights === undefined || isStringArray(album.copyrights))
  );
}

export function normalizeAlbumAddedAt(
  albums: StoredLibraryAlbum[],
  now = new Date(),
): LibraryAlbum[] {
  const validTimes = albums
    .map((album) => album.addedAt ? Date.parse(album.addedAt) : Number.NaN)
    .filter((time) => !Number.isNaN(time));
  const anchorTime = validTimes.length > 0 ? Math.min(...validTimes) : now.getTime();
  const legacyCount = albums.length - validTimes.length;
  let legacyIndex = 0;

  return albums.map((album) => {
    const existingTime = album.addedAt ? Date.parse(album.addedAt) : Number.NaN;
    if (!Number.isNaN(existingTime)) {
      return { ...album, addedAt: new Date(existingTime).toISOString() };
    }

    const addedAt = new Date(anchorTime - legacyCount + legacyIndex).toISOString();
    legacyIndex += 1;
    return { ...album, addedAt };
  });
}

export function createLibraryExport(albums: LibraryAlbum[], exportedAt = new Date()): string {
  const data: LibraryExport = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: exportedAt.toISOString(),
    albums,
  };
  return `${JSON.stringify(data, null, 2)}\n`;
}

export function parseLibraryExport(contents: string): LibraryAlbum[] {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error('This file is not valid JSON.');
  }

  if (typeof value !== 'object' || value === null) {
    throw new Error('This is not a Record Room library export.');
  }

  const data = value as Partial<LibraryExport>;
  if (data.format !== EXPORT_FORMAT) {
    throw new Error('This is not a Record Room library export.');
  }
  if (data.version !== EXPORT_VERSION) {
    throw new Error('This library export uses an unsupported version.');
  }
  if (!Array.isArray(data.albums) || !data.albums.every(isStoredLibraryAlbum)) {
    throw new Error('This library export contains invalid album data.');
  }

  const albums = normalizeAlbumAddedAt(data.albums);
  const ids = new Set<string>();
  for (const album of albums) {
    if (ids.has(album.id)) throw new Error('This library export contains duplicate albums.');
    ids.add(album.id);
  }

  return albums;
}

export function mergeAlbumsPreferImported(current: LibraryAlbum[], imported: LibraryAlbum[]): LibraryAlbum[] {
  const importedById = new Map(imported.map((album) => [album.id, album]));
  const merged = current.map((album) => {
    const importedAlbum = importedById.get(album.id);
    return importedAlbum ? { ...importedAlbum, addedAt: album.addedAt } : album;
  });
  const existingIds = new Set(current.map((album) => album.id));
  return [...merged, ...imported.filter((album) => !existingIds.has(album.id))];
}
