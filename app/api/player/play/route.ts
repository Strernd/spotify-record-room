import { spotifyErrorResponse, spotifyRequest } from "@/lib/spotify";

export const runtime = "nodejs";

const spotifyIdPattern = /^[A-Za-z0-9]+$/;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { albumId?: unknown; deviceId?: unknown };
    if (
      typeof body.albumId !== "string" ||
      typeof body.deviceId !== "string" ||
      !spotifyIdPattern.test(body.albumId) ||
      !spotifyIdPattern.test(body.deviceId)
    ) {
      return Response.json({ error: "Invalid playback request" }, { status: 400 });
    }

    const params = new URLSearchParams({ device_id: body.deviceId });
    await spotifyRequest(`/me/player/play?${params.toString()}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context_uri: `spotify:album:${body.albumId}`,
        offset: { position: 0 },
        position_ms: 0,
      }),
    });
    return Response.json({ playing: true });
  } catch (error) {
    return spotifyErrorResponse(error);
  }
}
