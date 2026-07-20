import type { LibraryAlbum } from './cd-library-types';

export const LIBRARY_SORT_OPTIONS = [
  { value: 'shelf', label: 'Shelf order' },
  { value: 'added-newest', label: 'Recently added' },
  { value: 'added-oldest', label: 'Oldest added' },
  { value: 'artist-asc', label: 'Artist: A–Z' },
  { value: 'artist-desc', label: 'Artist: Z–A' },
  { value: 'album-asc', label: 'Album: A–Z' },
  { value: 'album-desc', label: 'Album: Z–A' },
  { value: 'release-newest', label: 'Release year: newest' },
  { value: 'release-oldest', label: 'Release year: oldest' },
  { value: 'spine-color', label: 'Spine color' },
] as const;

export type LibrarySort = (typeof LIBRARY_SORT_OPTIONS)[number]['value'];

const textCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compareText(first: string, second: string): number {
  return textCollator.compare(first, second);
}

function addedAtTime(album: LibraryAlbum): number | null {
  if (!album.addedAt) return null;
  const time = Date.parse(album.addedAt);
  return Number.isNaN(time) ? null : time;
}

function parseColor(color: string): [number, number, number] | null {
  const hex = color.match(/^#([\da-f]{6})$/i);
  if (hex) {
    return [
      Number.parseInt(hex[1].slice(0, 2), 16),
      Number.parseInt(hex[1].slice(2, 4), 16),
      Number.parseInt(hex[1].slice(4, 6), 16),
    ];
  }

  const hsl = color.match(/^hsl\((\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\)$/i);
  if (!hsl) return null;
  return [Number(hsl[1]) % 360, Number(hsl[2]), Number(hsl[3])];
}

function colorSortKey(color: string): [number, number, number] {
  const parsed = parseColor(color);
  if (!parsed) return [361, 0, 0];
  if (color.startsWith('hsl')) return parsed;

  const [red, green, blue] = parsed.map((channel) => channel / 255);
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;

  if (delta !== 0) {
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }

  return [(hue + 360) % 360, saturation * 100, lightness * 100];
}

function compareColor(first: string, second: string): number {
  const firstKey = colorSortKey(first);
  const secondKey = colorSortKey(second);
  return (
    firstKey[0] - secondKey[0] ||
    secondKey[1] - firstKey[1] ||
    firstKey[2] - secondKey[2]
  );
}

export function sortLibraryAlbums(albums: LibraryAlbum[], sort: LibrarySort): LibraryAlbum[] {
  if (sort === 'shelf') return albums;

  return albums
    .map((album, shelfIndex) => ({ album, shelfIndex }))
    .sort((first, second) => {
      let comparison = 0;

      switch (sort) {
        case 'added-newest':
        case 'added-oldest': {
          const firstTime = addedAtTime(first.album);
          const secondTime = addedAtTime(second.album);
          if (firstTime === null && secondTime === null) {
            comparison = first.shelfIndex - second.shelfIndex;
          } else if (firstTime === null) {
            comparison = -1;
          } else if (secondTime === null) {
            comparison = 1;
          } else {
            comparison = firstTime - secondTime;
          }
          if (sort === 'added-newest') comparison *= -1;
          break;
        }
        case 'artist-asc':
        case 'artist-desc':
          comparison = compareText(first.album.artists[0] ?? '', second.album.artists[0] ?? '');
          if (sort === 'artist-desc') comparison *= -1;
          break;
        case 'album-asc':
        case 'album-desc':
          comparison = compareText(first.album.name, second.album.name);
          if (sort === 'album-desc') comparison *= -1;
          break;
        case 'release-newest':
        case 'release-oldest':
          comparison = compareText(first.album.releaseDate, second.album.releaseDate);
          if (sort === 'release-newest') comparison *= -1;
          break;
        case 'spine-color':
          comparison = compareColor(first.album.spineColor, second.album.spineColor);
          break;
      }

      return comparison || first.shelfIndex - second.shelfIndex;
    })
    .map(({ album }) => album);
}
