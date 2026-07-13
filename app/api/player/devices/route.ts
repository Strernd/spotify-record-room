import { spotifyErrorResponse, spotifyFetch } from "@/lib/spotify";

export const runtime = "nodejs";

type SpotifyDevice = {
  id: string | null;
  is_active: boolean;
  is_restricted: boolean;
  name: string;
  supports_volume: boolean;
  type: string;
  volume_percent: number | null;
};

export async function GET() {
  try {
    const data = await spotifyFetch<{ devices: SpotifyDevice[] }>("/me/player/devices");
    return Response.json({
      devices: data.devices
        .filter((device): device is SpotifyDevice & { id: string } => Boolean(device.id) && !device.is_restricted)
        .map((device) => ({
          id: device.id,
          isActive: device.is_active,
          name: device.name,
          supportsVolume: device.supports_volume,
          type: device.type,
          volumePercent: device.volume_percent,
        })),
    });
  } catch (error) {
    return spotifyErrorResponse(error);
  }
}
