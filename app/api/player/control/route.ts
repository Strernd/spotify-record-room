import { spotifyErrorResponse, spotifyRequest } from "@/lib/spotify";

export const runtime = "nodejs";

const spotifyIdPattern = /^[A-Za-z0-9]+$/;

type PlayerAction = "next" | "pause" | "previous" | "repeat" | "resume" | "seek" | "transfer" | "volume";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: unknown;
      deviceId?: unknown;
      positionMs?: unknown;
      repeat?: unknown;
      volumePercent?: unknown;
    };
    const action = body.action as PlayerAction;
    if (
      !["next", "pause", "previous", "repeat", "resume", "seek", "transfer", "volume"].includes(action) ||
      typeof body.deviceId !== "string" ||
      !spotifyIdPattern.test(body.deviceId)
    ) {
      return Response.json({ error: "Invalid player command" }, { status: 400 });
    }

    const params = new URLSearchParams({ device_id: body.deviceId });
    let path: string;
    let method: "POST" | "PUT" = "PUT";

    switch (action) {
      case "next":
      case "previous":
        path = `/me/player/${action}?${params}`;
        method = "POST";
        break;
      case "pause":
      case "resume":
        path = `/me/player/${action === "resume" ? "play" : "pause"}?${params}`;
        break;
      case "seek":
        if (typeof body.positionMs !== "number" || !Number.isFinite(body.positionMs) || body.positionMs < 0) {
          return Response.json({ error: "Invalid seek position" }, { status: 400 });
        }
        params.set("position_ms", String(Math.floor(body.positionMs)));
        path = `/me/player/seek?${params}`;
        break;
      case "volume":
        if (
          typeof body.volumePercent !== "number" ||
          !Number.isInteger(body.volumePercent) ||
          body.volumePercent < 0 ||
          body.volumePercent > 100
        ) {
          return Response.json({ error: "Invalid volume" }, { status: 400 });
        }
        params.set("volume_percent", String(body.volumePercent));
        path = `/me/player/volume?${params}`;
        break;
      case "repeat":
        if (body.repeat !== "context" && body.repeat !== "off") {
          return Response.json({ error: "Invalid repeat mode" }, { status: 400 });
        }
        params.set("state", body.repeat);
        path = `/me/player/repeat?${params}`;
        break;
      case "transfer":
        path = "/me/player";
        await spotifyRequest(path, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_ids: [body.deviceId], play: true }),
        });
        return Response.json({ ok: true });
    }

    await spotifyRequest(path, { method });
    return Response.json({ ok: true });
  } catch (error) {
    return spotifyErrorResponse(error);
  }
}
