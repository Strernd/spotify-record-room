export function normalizeTableAlbumIds(value: unknown, libraryAlbumIds: string[]): string[] {
  if (!Array.isArray(value)) return [];

  const libraryIds = new Set(libraryAlbumIds);
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (let index = value.length - 1; index >= 0; index -= 1) {
    const albumId = value[index];
    if (typeof albumId !== 'string' || !libraryIds.has(albumId) || seen.has(albumId)) continue;
    seen.add(albumId);
    normalized.unshift(albumId);
  }

  return normalized;
}

function withoutAlbum(tableAlbumIds: string[], albumId: string): string[] {
  return tableAlbumIds.filter((currentId) => currentId !== albumId);
}

export function addAlbumToTable(tableAlbumIds: string[], albumId: string): string[] {
  return [...withoutAlbum(tableAlbumIds, albumId), albumId];
}

export function returnAlbumToShelf(tableAlbumIds: string[], albumId: string): string[] {
  return withoutAlbum(tableAlbumIds, albumId);
}
