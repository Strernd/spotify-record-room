import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addLocalPlaybackDevice,
  clearDisconnectedLocalDevice,
  selectDeviceOnSdkReady,
} from './spotify-player-device.ts';

test('makes the SDK-ready browser device selectable without API discovery', () => {
  assert.deepEqual(
    addLocalPlaybackDevice([], 'sdk-device', 35),
    [{
      id: 'sdk-device',
      isActive: false,
      name: 'Record Room (this browser)',
      supportsVolume: true,
      type: 'computer',
      volumePercent: 35,
    }],
  );
});

test('does not duplicate a browser device already returned by Spotify', () => {
  const existing = {
    id: 'sdk-device',
    isActive: true,
    name: 'Existing browser player',
    supportsVolume: true,
    type: 'computer',
    volumePercent: 50,
  };

  const result = addLocalPlaybackDevice([existing], 'sdk-device', 35);

  assert.deepEqual(result, [existing]);
});

test('selects a new SDK device after the previous local device disconnects', () => {
  const afterDisconnect = clearDisconnectedLocalDevice('old-sdk-device', 'old-sdk-device');

  assert.equal(afterDisconnect, null);
  assert.equal(selectDeviceOnSdkReady(afterDisconnect, 'new-sdk-device'), 'new-sdk-device');
});

test('preserves an explicitly selected external device across SDK reconnects', () => {
  const afterDisconnect = clearDisconnectedLocalDevice('living-room-speaker', 'old-sdk-device');

  assert.equal(afterDisconnect, 'living-room-speaker');
  assert.equal(
    selectDeviceOnSdkReady(afterDisconnect, 'new-sdk-device'),
    'living-room-speaker',
  );
});
