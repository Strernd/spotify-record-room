import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import {
  exchangeAuthorizationCode,
  SPOTIFY_COOKIE_NAMES,
  SPOTIFY_APP_ORIGIN,
  storeSpotifyTokens,
} from "@/lib/spotify";

export const runtime = "nodejs";

function homeRedirect(params?: Record<string, string>) {
  const url = new URL("/", SPOTIFY_APP_ORIGIN);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(SPOTIFY_COOKIE_NAMES.state)?.value;
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const spotifyError = request.nextUrl.searchParams.get("error");

  cookieStore.set(SPOTIFY_COOKIE_NAMES.state, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  if (spotifyError) {
    return homeRedirect({ spotify_error: spotifyError });
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return homeRedirect({ spotify_error: "invalid_state" });
  }

  try {
    const tokens = await exchangeAuthorizationCode(code);
    await storeSpotifyTokens(tokens);
    return homeRedirect({ spotify: "connected" });
  } catch {
    return homeRedirect({ spotify_error: "authentication_failed" });
  }
}
