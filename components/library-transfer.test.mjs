import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mergeAlbumsPreferImported,
  normalizeAlbumAddedAt,
  parseLibraryExport,
} from './library-transfer.ts';

function album(overrides) {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    artists: ['Artist'],
    imageUrl: '',
    spotifyUrl: '',
    releaseDate: '2000',
    totalTracks: 1,
    tracks: [],
    spineColor: '#ff0000',
    ...overrides,
  };
}

test('normalizes legacy albums to explicit timestamps in their existing order', () => {
  const normalized = normalizeAlbumAddedAt(
    [album({ id: 'first' }), album({ id: 'second' })],
    new Date('2026-07-13T12:00:00.000Z'),
  );

  assert.deepEqual(
    normalized.map(({ addedAt }) => addedAt),
    ['2026-07-13T11:59:59.998Z', '2026-07-13T11:59:59.999Z'],
  );
});

test('places legacy albums before the earliest existing timestamp', () => {
  const normalized = normalizeAlbumAddedAt([
    album({ id: 'legacy' }),
    album({ id: 'dated', addedAt: '2024-01-01T00:00:00.000Z' }),
  ]);

  assert.ok(normalized[0].addedAt < normalized[1].addedAt);
});

test('parses old exports and returns explicit timestamps', () => {
  const contents = JSON.stringify({
    format: 'spotify-cd-shelves-library',
    version: 1,
    exportedAt: '2024-01-01T00:00:00.000Z',
    albums: [album({ id: 'legacy' })],
  });

  assert.match(parseLibraryExport(contents)[0].addedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('merge keeps the current shelf timestamp for a matching album', () => {
  const current = album({ id: 'same', name: 'Old metadata', addedAt: '2024-01-01T00:00:00.000Z' });
  const imported = album({ id: 'same', name: 'Updated metadata', addedAt: '2026-01-01T00:00:00.000Z' });
  const [merged] = mergeAlbumsPreferImported([current], [imported]);

  assert.equal(merged.name, 'Updated metadata');
  assert.equal(merged.addedAt, current.addedAt);
});
