import assert from 'node:assert/strict';
import test from 'node:test';

import { sortLibraryAlbums } from './library-sort.ts';

function album(overrides) {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    artists: overrides.artists ?? ['Artist'],
    imageUrl: '',
    spotifyUrl: '',
    releaseDate: overrides.releaseDate ?? '2000',
    totalTracks: 1,
    tracks: [],
    spineColor: overrides.spineColor ?? '#ff0000',
    ...overrides,
  };
}

function ids(albums) {
  return albums.map(({ id }) => id);
}

const shelf = [
  album({ id: 'second', name: '10,000 Hz Legend', artists: ['Air'], releaseDate: '2001', addedAt: '2024-02-01T00:00:00.000Z', spineColor: '#00ff00' }),
  album({ id: 'first', name: 'Ágætis byrjun', artists: ['Sigur Rós'], releaseDate: '1999', addedAt: '2024-01-01T00:00:00.000Z', spineColor: '#ff0000' }),
  album({ id: 'legacy', name: 'Blue', artists: ['Air'], releaseDate: '1971', spineColor: '#0000ff' }),
];

test('shelf order returns the canonical array unchanged', () => {
  assert.equal(sortLibraryAlbums(shelf, 'shelf'), shelf);
});

test('sorts addition dates and treats legacy entries as older', () => {
  assert.deepEqual(ids(sortLibraryAlbums(shelf, 'added-newest')), ['second', 'first', 'legacy']);
  assert.deepEqual(ids(sortLibraryAlbums(shelf, 'added-oldest')), ['legacy', 'first', 'second']);
});

test('sorts artist and uses shelf order to break ties', () => {
  assert.deepEqual(ids(sortLibraryAlbums(shelf, 'artist-asc')), ['second', 'legacy', 'first']);
  assert.deepEqual(ids(sortLibraryAlbums(shelf, 'artist-desc')), ['first', 'second', 'legacy']);
});

test('sorts album titles and release dates in both directions', () => {
  assert.deepEqual(ids(sortLibraryAlbums(shelf, 'album-asc')), ['second', 'first', 'legacy']);
  assert.deepEqual(ids(sortLibraryAlbums(shelf, 'album-desc')), ['legacy', 'first', 'second']);
  assert.deepEqual(ids(sortLibraryAlbums(shelf, 'release-newest')), ['second', 'first', 'legacy']);
  assert.deepEqual(ids(sortLibraryAlbums(shelf, 'release-oldest')), ['legacy', 'first', 'second']);
});

test('sorts spine colors into a hue gradient', () => {
  assert.deepEqual(ids(sortLibraryAlbums(shelf, 'spine-color')), ['first', 'second', 'legacy']);
});
