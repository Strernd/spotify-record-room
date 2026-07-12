# Needle Drop

A local-first visual CD shelf powered by Spotify catalog data. Albums, artwork URLs, track lists, and presentation colors are stored in the browser's local storage; Spotify is only contacted when you sign in and add new music.

## Spotify setup

Create a Spotify developer app and add this exact redirect URI:

```text
http://127.0.0.1:3000/callback
```

Create `.env.local` in the project root:

```bash
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
```

Keep both values server-side. They are intentionally not prefixed with `NEXT_PUBLIC_`.

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Using `localhost` will not match the registered Spotify callback.

## Checks

```bash
npm run lint
npm run build
```
