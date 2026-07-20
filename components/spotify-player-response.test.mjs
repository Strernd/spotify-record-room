import assert from 'node:assert/strict';
import test from 'node:test';

import { spotifyPlayerResponseError } from './spotify-player-response.ts';

test('turns a play endpoint rate limit into an actionable Retry-After error', async () => {
  const response = new Response(null, {
    status: 429,
    headers: { 'Retry-After': '10939' },
  });

  const error = await spotifyPlayerResponseError(
    response,
    'Spotify could not start this album.',
  );

  assert.equal(
    error.message,
    'Spotify is rate-limiting this app. Try again in about 3h 3m.',
  );
});

test('uses a Spotify response error before the caller fallback', async () => {
  const response = new Response(JSON.stringify({ error: 'No active device.' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });

  const error = await spotifyPlayerResponseError(response, 'Fallback message.');

  assert.equal(error.message, 'No active device.');
});
