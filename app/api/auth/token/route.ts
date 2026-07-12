import { getSpotifyAccessToken, spotifyErrorResponse } from "@/lib/spotify";

export const runtime = "nodejs";

export async function POST() {
  try {
    const accessToken = await getSpotifyAccessToken();
    return Response.json(
      { accessToken },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (error) {
    return spotifyErrorResponse(error);
  }
}
