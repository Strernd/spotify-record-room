import { randomBytes } from "node:crypto";

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import {
  getSpotifyAuthorizationUrl,
  SPOTIFY_APP_ORIGIN,
  SPOTIFY_COOKIE_NAMES,
  spotifyErrorResponse,
  spotifyStateCookieOptions,
} from "@/lib/spotify";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  // OAuth state cookies are host-bound. Canonicalize localhost so the cookie is
  // available when Spotify returns to the registered 127.0.0.1 callback.
  // Next's development URL can be normalized, so use the incoming Host header.
  const canonicalHost = new URL(SPOTIFY_APP_ORIGIN).host;
  if (request.headers.get("host") !== canonicalHost) {
    return NextResponse.redirect(new URL("/api/auth/login", SPOTIFY_APP_ORIGIN));
  }

  try {
    const state = randomBytes(32).toString("base64url");
    const cookieStore = await cookies();
    cookieStore.set(SPOTIFY_COOKIE_NAMES.state, state, spotifyStateCookieOptions());
    return NextResponse.redirect(getSpotifyAuthorizationUrl(state));
  } catch (error) {
    return spotifyErrorResponse(error);
  }
}
