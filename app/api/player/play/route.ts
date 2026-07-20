import { spotifyErrorResponse, spotifyRequest } from "@/lib/spotify";

export const runtime = "nodejs";

const spotifyIdPattern = /^[A-Za-z0-9]+$/;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      albumId?: unknown;
      deviceId?: unknown;
      positionMs?: unknown;
      trackId?: unknown;
    };
    if (
      typeof body.albumId !== "string" ||
      typeof body.deviceId !== "string" ||
      !spotifyIdPattern.test(body.albumId) ||
      !spotifyIdPattern.test(body.deviceId) ||
      (body.trackId !== undefined &&
        (typeof body.trackId !== "string" || !spotifyIdPattern.test(body.trackId))) ||
      (body.positionMs !== undefined &&
        (typeof body.positionMs !== "number" ||
          !Number.isFinite(body.positionMs) ||
          body.positionMs < 0))
    ) {
      return Response.json({ error: "Invalid playback request" }, { status: 400 });
    }

    const params = new URLSearchParams({ device_id: body.deviceId });
    const positionMs = Math.floor(body.positionMs ?? 0);
    await spotifyRequest(`/me/player/play?${params.toString()}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context_uri: `spotify:album:${body.albumId}`,
        offset: body.trackId
          ? { uri: `spotify:track:${body.trackId}` }
          : { position: 0 },
        position_ms: positionMs,
      }),
    });
    const repeatParams = new URLSearchParams({ device_id: body.deviceId, state: "context" });
    await spotifyRequest(`/me/player/repeat?${repeatParams.toString()}`, { method: "PUT" });
    return Response.json({ playing: true });
  } catch (error) {
    return spotifyErrorResponse(error);
  }
}
