export type PlaybackDevice = {
  id: string;
  isActive: boolean;
  name: string;
  supportsVolume: boolean;
  type: string;
  volumePercent: number | null;
};

export function addLocalPlaybackDevice(
  devices: PlaybackDevice[],
  localDeviceId: string,
  volumePercent: number,
): PlaybackDevice[] {
  if (devices.some((device) => device.id === localDeviceId)) {
    return devices;
  }

  return [
    ...devices,
    {
      id: localDeviceId,
      isActive: false,
      name: 'Record Room (this browser)',
      supportsVolume: true,
      type: 'computer',
      volumePercent,
    },
  ];
}

export function clearDisconnectedLocalDevice(
  selectedDeviceId: string | null,
  disconnectedLocalDeviceId: string | null,
): string | null {
  return selectedDeviceId === disconnectedLocalDeviceId ? null : selectedDeviceId;
}

export function selectDeviceOnSdkReady(
  selectedDeviceId: string | null,
  localDeviceId: string,
): string {
  return selectedDeviceId ?? localDeviceId;
}
