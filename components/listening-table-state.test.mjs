import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addAlbumToTable,
  normalizeTableAlbumIds,
  returnAlbumToShelf,
} from './listening-table-state.ts';

test('keeps only unique table albums that still exist in the library', () => {
  assert.deepEqual(
    normalizeTableAlbumIds(['blue', 'missing', 'kind-of-blue', 'blue', 42], ['blue', 'kind-of-blue']),
    ['kind-of-blue', 'blue'],
  );
});

test('puts a played album on top of the table without duplicating it', () => {
  assert.deepEqual(addAlbumToTable(['blue', 'kind-of-blue'], 'blue'), ['kind-of-blue', 'blue']);
  assert.deepEqual(addAlbumToTable([], 'blue'), ['blue']);
});

test('returns one album to the shelf without disturbing the rest of the stack', () => {
  assert.deepEqual(returnAlbumToShelf(['blue', 'kind-of-blue', 'vespertine'], 'kind-of-blue'), [
    'blue',
    'vespertine',
  ]);
});
