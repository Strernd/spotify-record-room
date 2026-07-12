import { NextRequest } from "next/server";

import {
  normalizeAlbum,
  spotifyErrorResponse,
  spotifyFetch,
} from "@/lib/spotify";
import type { AlbumSummary } from "@/lib/spotify-contracts";

export const runtime = "nodejs";

type SearchResponse = {
  albums: { items: Parameters<typeof normalizeAlbum>[0][] };
};

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query) {
    return Response.json({ albums: [] satisfies AlbumSummary[] });
  }

  try {
    const params = new URLSearchParams({ q: query, type: "album", limit: "20" });
    const result = await spotifyFetch<SearchResponse>(`/search?${params.toString()}`);
    return Response.json({ albums: result.albums.items.map(normalizeAlbum) });
  } catch (error) {
    return spotifyErrorResponse(error);
  }
}
