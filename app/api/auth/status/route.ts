import { getSpotifyAccessToken, hasSpotifyPlaybackScopes } from "@/lib/spotify";

export const runtime = "nodejs";

export async function GET() {
  try {
    await getSpotifyAccessToken();
    return Response.json({ authenticated: true, playbackReady: await hasSpotifyPlaybackScopes() });
  } catch {
    return Response.json({ authenticated: false, playbackReady: false });
  }
}
