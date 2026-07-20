import "server-only";

import { cookies } from "next/headers";

import type {
  AlbumDetail,
  AlbumSummary,
} from "@/lib/spotify-contracts";
import { parseRetryAfterSeconds } from "@/lib/spotify-rate-limit";

export const SPOTIFY_APP_ORIGIN =
  process.env.SPOTIFY_APP_ORIGIN ?? "http://127.0.0.1:3000";
export const SPOTIFY_REDIRECT_URI = new URL(
  "/callback",
  SPOTIFY_APP_ORIGIN,
).toString();

export const SPOTIFY_COOKIE_NAMES = {
  accessToken: "spotify_access_token",
  refreshToken: "spotify_refresh_token",
  expiresAt: "spotify_expires_at",
  scope: "spotify_scope",
  state: "spotify_oauth_state",
} as const;

export const SPOTIFY_PLAYBACK_SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
] as const;

const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";

const tokenCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export type { AlbumDetail, AlbumSummary } from "@/lib/spotify-contracts";

type SpotifyImage = { url: string; width: number | null; height: number | null };
type SpotifyArtist = { name: string };

type SpotifyAlbum = {
  id: string;
  name: string;
  artists: SpotifyArtist[];
  images: SpotifyImage[];
  external_urls: { spotify: string };
  release_date: string;
  total_tracks: number;
};

type SpotifyTrack = {
  id: string;
  name: string;
  duration_ms: number;
  track_number: number;
  disc_number: number;
  external_urls: { spotify: string };
};

export type SpotifyAlbumDetail = SpotifyAlbum & {
  label?: string;
  copyrights?: Array<{ text: string }>;
  tracks: {
    items: SpotifyTrack[];
    next: string | null;
  };
};

type TokenResponse = {
  access_token: string;
  token_type: string;
  scope?: string;
  expires_in: number;
  refresh_token?: string;
};

export class SpotifyAuthError extends Error {
  constructor(message = "Spotify authentication is required") {
    super(message);
    this.name = "SpotifyAuthError";
  }
}

export class SpotifyApiError extends Error {
  retryAfterSeconds: number | null;
  status: number;

  constructor(status: number, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "SpotifyApiError";
    this.retryAfterSeconds = retryAfterSeconds;
    this.status = status;
  }
}

function spotifyCredentials() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be configured");
  }

  return { clientId, clientSecret };
}

function basicAuthorization() {
  const { clientId, clientSecret } = spotifyCredentials();
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function requestToken(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthorization(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new SpotifyAuthError("Spotify rejected the authentication request");
  }

  return response.json() as Promise<TokenResponse>;
}

export function getSpotifyAuthorizationUrl(state: string) {
  const { clientId } = spotifyCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: SPOTIFY_REDIRECT_URI,
    scope: SPOTIFY_PLAYBACK_SCOPES.join(" "),
    state,
  });

  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export function spotifyStateCookieOptions() {
  return { ...tokenCookieOptions, maxAge: 10 * 60 };
}

export async function exchangeAuthorizationCode(code: string) {
  return requestToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: SPOTIFY_REDIRECT_URI,
    }),
  );
}

export async function storeSpotifyTokens(tokens: TokenResponse) {
  const cookieStore = await cookies();
  const expiresAt = Date.now() + tokens.expires_in * 1000;

  cookieStore.set(SPOTIFY_COOKIE_NAMES.accessToken, tokens.access_token, tokenCookieOptions);
  cookieStore.set(SPOTIFY_COOKIE_NAMES.expiresAt, String(expiresAt), tokenCookieOptions);
  if (tokens.refresh_token) {
    cookieStore.set(SPOTIFY_COOKIE_NAMES.refreshToken, tokens.refresh_token, tokenCookieOptions);
  }
  if (tokens.scope) {
    cookieStore.set(SPOTIFY_COOKIE_NAMES.scope, tokens.scope, tokenCookieOptions);
  }
}

export async function hasSpotifyPlaybackScopes() {
  const cookieStore = await cookies();
  const grantedScopes = new Set(
    (cookieStore.get(SPOTIFY_COOKIE_NAMES.scope)?.value ?? "").split(" ").filter(Boolean),
  );
  return SPOTIFY_PLAYBACK_SCOPES.every((scope) => grantedScopes.has(scope));
}

export async function clearSpotifyCookies() {
  const cookieStore = await cookies();
  for (const name of Object.values(SPOTIFY_COOKIE_NAMES)) {
    cookieStore.set(name, "", { ...tokenCookieOptions, maxAge: 0 });
  }
}

async function refreshSpotifyAccessToken(refreshToken: string) {
  const tokens = await requestToken(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  );
  await storeSpotifyTokens(tokens);
  return tokens.access_token;
}

export async function getSpotifyAccessToken() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(SPOTIFY_COOKIE_NAMES.accessToken)?.value;
  const refreshToken = cookieStore.get(SPOTIFY_COOKIE_NAMES.refreshToken)?.value;
  const expiresAt = Number(cookieStore.get(SPOTIFY_COOKIE_NAMES.expiresAt)?.value ?? 0);

  if (accessToken && Number.isFinite(expiresAt) && expiresAt > Date.now() + 30_000) {
    return accessToken;
  }

  if (!refreshToken) {
    throw new SpotifyAuthError();
  }

  try {
    return await refreshSpotifyAccessToken(refreshToken);
  } catch {
    await clearSpotifyCookies();
    throw new SpotifyAuthError("Your Spotify session expired. Please connect again.");
  }
}

export async function spotifyRequest(path: string, init: RequestInit = {}) {
  const accessToken = await getSpotifyAccessToken();
  const url = path.startsWith(`${SPOTIFY_API_BASE}/`) ? path : `${SPOTIFY_API_BASE}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (response.status === 401) {
    await clearSpotifyCookies();
    throw new SpotifyAuthError("Your Spotify session expired. Please connect again.");
  }

  if (!response.ok) {
    let message = "Spotify could not complete the request";
    const retryAfterSeconds = response.status === 429
      ? parseRetryAfterSeconds(response.headers.get("Retry-After"))
      : null;
    try {
      const payload = (await response.json()) as { error?: { message?: string } };
      message = payload.error?.message || message;
    } catch {
      // Spotify occasionally returns an empty or non-JSON error response.
    }
    throw new SpotifyApiError(response.status, message, retryAfterSeconds);
  }

  return response;
}

export async function spotifyFetch<T>(path: string): Promise<T> {
  const response = await spotifyRequest(path);
  return response.json() as Promise<T>;
}

export function normalizeAlbum(album: SpotifyAlbum): AlbumSummary {
  return {
    id: album.id,
    name: album.name,
    artists: album.artists.map((artist) => artist.name),
    imageUrl: album.images[0]?.url ?? "",
    spotifyUrl: album.external_urls.spotify,
    releaseDate: album.release_date,
    totalTracks: album.total_tracks,
  };
}

export function normalizeAlbumDetail(album: SpotifyAlbumDetail): AlbumDetail {
  return {
    ...normalizeAlbum(album),
    tracks: album.tracks.items.map((track) => ({
      id: track.id,
      name: track.name,
      durationMs: track.duration_ms,
      trackNumber: track.track_number,
      discNumber: track.disc_number,
      spotifyUrl: track.external_urls.spotify,
    })),
    ...(album.label ? { label: album.label } : {}),
    ...(album.copyrights?.length
      ? { copyrights: album.copyrights.map((copyright) => copyright.text) }
      : {}),
  };
}

export function spotifyErrorResponse(error: unknown) {
  if (error instanceof SpotifyAuthError) {
    return Response.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof SpotifyApiError) {
    const status = error.status >= 400 && error.status < 600 ? error.status : 502;
    const headers = error.retryAfterSeconds === null
      ? undefined
      : { "Retry-After": String(error.retryAfterSeconds) };
    return Response.json({ error: error.message }, { headers, status });
  }

  console.error("Unexpected Spotify integration error", error);
  return Response.json({ error: "Spotify is temporarily unavailable" }, { status: 502 });
}
