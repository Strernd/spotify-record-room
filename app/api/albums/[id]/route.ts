import {
  normalizeAlbumDetail,
  spotifyErrorResponse,
  spotifyFetch,
  type SpotifyAlbumDetail,
} from "@/lib/spotify";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const album = await spotifyFetch<SpotifyAlbumDetail>(
      `/albums/${encodeURIComponent(id)}?market=from_token`,
    );

    while (album.tracks.next) {
      const page = await spotifyFetch<SpotifyAlbumDetail["tracks"]>(album.tracks.next);
      album.tracks.items.push(...page.items);
      album.tracks.next = page.next;
    }

    return Response.json(normalizeAlbumDetail(album));
  } catch (error) {
    return spotifyErrorResponse(error);
  }
}
