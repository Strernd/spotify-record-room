import { spotifyErrorResponse, spotifyRequest } from "@/lib/spotify";

export const runtime = "nodejs";

type SpotifyPlayback = {
  device: { id: string | null };
  is_playing: boolean;
  item: null | {
    album: { images: Array<{ url: string }> };
    artists: Array<{ name: string }>;
    duration_ms: number;
    id: string | null;
    name: string;
  };
  progress_ms: number | null;
};

export async function GET() {
  try {
    const response = await spotifyRequest("/me/player");
    if (response.status === 204) return Response.json({ playback: null });
    const playback = (await response.json()) as SpotifyPlayback;
    if (!playback.item?.id) return Response.json({ playback: null });
    return Response.json({
      playback: {
        deviceId: playback.device.id,
        duration: playback.item.duration_ms,
        paused: !playback.is_playing,
        position: playback.progress_ms ?? 0,
        track: {
          album: playback.item.album,
          artists: playback.item.artists,
          id: playback.item.id,
          name: playback.item.name,
        },
      },
    });
  } catch (error) {
    return spotifyErrorResponse(error);
  }
}
