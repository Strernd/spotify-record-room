import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_RATE_LIMIT_BACKOFF_MS,
  EXTERNAL_PLAYER_STATE_POLL_INTERVAL_MS,
  PollCoordinator,
  shouldPollPlayerState,
  spotifyPollDelayMs,
} from './spotify-player-polling.ts';
import {
  parseRetryAfterSeconds,
  spotifyRateLimitMessage,
} from '../lib/spotify-rate-limit.ts';

test('polls playback state only for a visible external device', () => {
  assert.equal(shouldPollPlayerState({
    hidden: false,
    localDeviceId: 'local',
    outputDeviceId: 'speaker',
    pageVisible: true,
  }), true);
  assert.equal(shouldPollPlayerState({
    hidden: false,
    localDeviceId: 'local',
    outputDeviceId: 'local',
    pageVisible: true,
  }), false);
  assert.equal(shouldPollPlayerState({
    hidden: true,
    localDeviceId: 'local',
    outputDeviceId: 'speaker',
    pageVisible: true,
  }), false);
  assert.equal(shouldPollPlayerState({
    hidden: false,
    localDeviceId: 'local',
    outputDeviceId: 'speaker',
    pageVisible: false,
  }), false);
  assert.equal(shouldPollPlayerState({
    hidden: false,
    localDeviceId: 'local',
    outputDeviceId: null,
    pageVisible: true,
  }), false);
});

test('uses the normal external-device cadence when Spotify accepts the request', () => {
  assert.equal(
    spotifyPollDelayMs(200, null),
    EXTERNAL_PLAYER_STATE_POLL_INTERVAL_MS,
  );
});

test('honors Retry-After without retrying faster than the normal cadence', () => {
  assert.equal(
    spotifyPollDelayMs(429, '45'),
    45_000,
  );
  assert.equal(
    spotifyPollDelayMs(429, '2'),
    EXTERNAL_PLAYER_STATE_POLL_INTERVAL_MS,
  );
});

test('uses a conservative backoff when a 429 omits Retry-After', () => {
  assert.equal(
    spotifyPollDelayMs(429, null),
    DEFAULT_RATE_LIMIT_BACKOFF_MS,
  );
  assert.equal(
    spotifyPollDelayMs(429, 'not-a-number'),
    DEFAULT_RATE_LIMIT_BACKOFF_MS,
  );
  assert.equal(
    spotifyPollDelayMs(429, ''),
    DEFAULT_RATE_LIMIT_BACKOFF_MS,
  );
});

test('applies Retry-After to the slower device-refresh cadence', () => {
  assert.equal(spotifyPollDelayMs(200, null, 60_000), 60_000);
  assert.equal(spotifyPollDelayMs(429, '120', 60_000), 120_000);
  assert.equal(spotifyPollDelayMs(429, '45', 60_000), 60_000);
});

test('parses Retry-After as non-negative whole seconds', () => {
  assert.equal(parseRetryAfterSeconds('12'), 12);
  assert.equal(parseRetryAfterSeconds('1.2'), 2);
  assert.equal(parseRetryAfterSeconds('0'), 0);
  assert.equal(parseRetryAfterSeconds('-1'), null);
  assert.equal(parseRetryAfterSeconds('later'), null);
  assert.equal(parseRetryAfterSeconds(null), null);
});

test('explains Spotify rate limits using the retry window', () => {
  assert.equal(
    spotifyRateLimitMessage('10939'),
    'Spotify is rate-limiting this app. Try again in about 3h 3m.',
  );
  assert.equal(
    spotifyRateLimitMessage(null),
    'Spotify is rate-limiting this app. Please try again later.',
  );
});

test('keeps one request in flight across scheduler restarts', async () => {
  let finishRequest;
  let requestCount = 0;
  let now = 1_000;
  const coordinator = new PollCoordinator(() => now);
  const poll = () => {
    requestCount += 1;
    return new Promise((resolve) => {
      finishRequest = resolve;
    });
  };

  const first = coordinator.request(poll, 15_000);
  const joined = coordinator.request(poll, 15_000);
  assert.equal(joined, first);
  assert.equal(requestCount, 1);

  finishRequest(45_000);
  await first;
  assert.equal(coordinator.remainingDelayMs(), 45_000);
  now += 10_000;
  assert.equal(coordinator.remainingDelayMs(), 35_000);
});

test('preserves a fallback deadline after a failed request', async () => {
  const coordinator = new PollCoordinator(() => 5_000);
  await coordinator.request(() => Promise.reject(new Error('network unavailable')), 60_000);
  assert.equal(coordinator.remainingDelayMs(), 60_000);
});
