import type { AlbumTrack, LibraryAlbum } from './cd-library-types';

const EXPORT_FORMAT = 'spotify-cd-shelves-library';
const EXPORT_VERSION = 1;

type LibraryExport = {
  albums: LibraryAlbum[];
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

function isLibraryAlbum(value: unknown): value is LibraryAlbum {
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
    (album.label === undefined || typeof album.label === 'string') &&
    (album.copyrights === undefined || isStringArray(album.copyrights))
  );
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
  if (!Array.isArray(data.albums) || !data.albums.every(isLibraryAlbum)) {
    throw new Error('This library export contains invalid album data.');
  }

  const ids = new Set<string>();
  for (const album of data.albums) {
    if (ids.has(album.id)) throw new Error('This library export contains duplicate albums.');
    ids.add(album.id);
  }

  return data.albums;
}

export function mergeAlbumsPreferImported(current: LibraryAlbum[], imported: LibraryAlbum[]): LibraryAlbum[] {
  const importedById = new Map(imported.map((album) => [album.id, album]));
  const merged = current.map((album) => importedById.get(album.id) ?? album);
  const existingIds = new Set(current.map((album) => album.id));
  return [...merged, ...imported.filter((album) => !existingIds.has(album.id))];
}
