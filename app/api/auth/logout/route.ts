import { clearSpotifyCookies, SPOTIFY_APP_ORIGIN } from "@/lib/spotify";

export const runtime = "nodejs";

export async function POST() {
  await clearSpotifyCookies();
  return Response.json({ authenticated: false });
}

export async function GET() {
  await clearSpotifyCookies();
  return Response.redirect(new URL("/", SPOTIFY_APP_ORIGIN));
}
