import { getSpotifyAccessToken } from "@/lib/spotify";

export const runtime = "nodejs";

export async function GET() {
  try {
    await getSpotifyAccessToken();
    return Response.json({ authenticated: true });
  } catch {
    return Response.json({ authenticated: false });
  }
}
