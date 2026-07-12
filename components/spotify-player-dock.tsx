'use client';

import Script from 'next/script';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

import type { LibraryAlbum } from './cd-library-types';

type WebPlaybackTrack = {
  album: { images: Array<{ url: string }> };
  artists: Array<{ name: string }>;
  name: string;
};

type WebPlaybackState = {
  duration: number;
  paused: boolean;
  position: number;
  track_window: { current_track: WebPlaybackTrack };
};

type SpotifyPlayer = {
  activateElement: () => Promise<void>;
  addListener: {
    (event: 'ready', listener: (value: { device_id: string }) => void): boolean;
    (event: 'not_ready' | 'autoplay_failed', listener: () => void): boolean;
    (event: 'player_state_changed', listener: (state: WebPlaybackState | null) => void): boolean;
    (event: 'initialization_error' | 'playback_error', listener: (value: { message: string }) => void): boolean;
    (event: 'authentication_error' | 'account_error', listener: () => void): boolean;
  };
  connect: () => Promise<boolean>;
  disconnect: () => void;
  nextTrack: () => Promise<void>;
  pause: () => Promise<void>;
  previousTrack: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  togglePlay: () => Promise<void>;
};

type SpotifyPlayerConstructor = new (options: {
  getOAuthToken: (callback: (accessToken: string) => void) => void;
  name: string;
  volume: number;
}) => SpotifyPlayer;

export type SpotifyPlayerHandle = {
  pause: () => void;
  play: (album: LibraryAlbum) => void;
};

declare global {
  interface Window {
    Spotify?: { Player: SpotifyPlayerConstructor };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, '0')}`;
}

async function getPlaybackToken(): Promise<string> {
  const response = await fetch('/api/auth/token', { method: 'POST', cache: 'no-store' });
  if (!response.ok) throw new Error('Reconnect Spotify to enable full playback.');
  const data = (await response.json()) as { accessToken?: string };
  if (!data.accessToken) throw new Error('Spotify did not return a playback token.');
  return data.accessToken;
}

export const SpotifyPlayerDock = forwardRef<SpotifyPlayerHandle, {
  hidden?: boolean;
  initialAlbum: LibraryAlbum;
  onClose: () => void;
}>(function SpotifyPlayerDock({ hidden = false, initialAlbum, onClose }, ref) {
  const playerRef = useRef<SpotifyPlayer | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const pendingAlbumRef = useRef<{ album: LibraryAlbum; intent: number } | null>(null);
  const playbackIntentRef = useRef(0);
  const initialAlbumRef = useRef(initialAlbum);
  const [currentAlbum, setCurrentAlbum] = useState(initialAlbumRef.current);
  const [currentTrack, setCurrentTrack] = useState<WebPlaybackTrack | null>(null);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(true);
  const [position, setPosition] = useState(0);
  const [scriptReady, setScriptReady] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [status, setStatus] = useState('Connecting full player…');

  const reportCommandError = useCallback((commandError: unknown) => {
    setError(commandError instanceof Error ? commandError.message : 'Spotify could not complete that command.');
    setStatus('Playback unavailable');
  }, []);

  const startAlbum = useCallback(async (album: LibraryAlbum, deviceId: string, intent: number) => {
    setCurrentAlbum(album);
    setStatus('Starting album…');
    setError('');
    try {
      const response = await fetch('/api/player/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ albumId: album.id, deviceId }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || 'Spotify could not start this album.');
      }
      if (intent !== playbackIntentRef.current) {
        await playerRef.current?.pause();
        return;
      }
      if (pendingAlbumRef.current?.intent === intent) pendingAlbumRef.current = null;
    } catch (playError) {
      if (intent !== playbackIntentRef.current) return;
      setError(playError instanceof Error ? playError.message : 'Spotify could not start this album.');
      setStatus('Playback unavailable');
    }
  }, []);

  const pausePlayback = useCallback(() => {
    const intent = playbackIntentRef.current + 1;
    playbackIntentRef.current = intent;
    pendingAlbumRef.current = null;
    const player = playerRef.current;
    if (!player) return;
    void player.pause()
      .then(() => {
        if (intent !== playbackIntentRef.current) return;
        setPaused(true);
        setStatus('Paused');
      })
      .catch((commandError: unknown) => {
        if (intent === playbackIntentRef.current) reportCommandError(commandError);
      });
  }, [reportCommandError]);

  useImperativeHandle(ref, () => ({
    pause: pausePlayback,
    play(album) {
      const intent = playbackIntentRef.current + 1;
      playbackIntentRef.current = intent;
      pendingAlbumRef.current = { album, intent };
      setCurrentAlbum(album);
      setError('');
      void playerRef.current?.activateElement().catch(reportCommandError);
      const deviceId = deviceIdRef.current;
      if (deviceId) {
        void startAlbum(album, deviceId, intent);
      } else {
        setStatus('Waiting for Spotify player…');
      }
    },
  }), [pausePlayback, reportCommandError, startAlbum]);

  useEffect(() => {
    window.onSpotifyWebPlaybackSDKReady = () => setSdkReady(true);
    if (window.Spotify) setSdkReady(true);
    setScriptReady(true);
  }, []);

  useEffect(() => {
    if (!sdkReady || !window.Spotify) return;
    let cancelled = false;
    const player = new window.Spotify.Player({
      name: 'Record Room',
      volume: 0.65,
      getOAuthToken(callback) {
        void getPlaybackToken()
          .then(callback)
          .catch((tokenError: unknown) => {
            if (!cancelled) {
              setError(tokenError instanceof Error ? tokenError.message : 'Could not authenticate the player.');
              setStatus('Reconnect Spotify');
            }
          });
      },
    });
    playerRef.current = player;

    player.addListener('ready', ({ device_id }: { device_id: string }) => {
      if (cancelled) return;
      deviceIdRef.current = device_id;
      setStatus('Full player ready');
      const pending = pendingAlbumRef.current;
      if (pending) {
        void startAlbum(pending.album, device_id, pending.intent);
      }
    });
    player.addListener('not_ready', () => {
      deviceIdRef.current = null;
      setStatus('Player reconnecting…');
    });
    player.addListener('player_state_changed', (state: WebPlaybackState | null) => {
      if (!state) return;
      setCurrentTrack(state.track_window.current_track);
      setDuration(state.duration);
      setPaused(state.paused);
      setPosition(state.position);
      setStatus(state.paused ? 'Paused' : 'Playing full track');
    });
    player.addListener('autoplay_failed', () => {
      setPaused(true);
      setStatus('Press play to start audio.');
    });
    player.addListener('initialization_error', ({ message }: { message: string }) => setError(message));
    player.addListener('authentication_error', () => setError('Reconnect Spotify to enable full playback.'));
    player.addListener('account_error', () => setError('Full playback requires Spotify Premium.'));
    player.addListener('playback_error', ({ message }: { message: string }) => setError(message));

    void player.connect().then((connected) => {
      if (!connected && !cancelled) setError('Could not connect the Spotify player.');
    });

    return () => {
      cancelled = true;
      deviceIdRef.current = null;
      player.disconnect();
      playerRef.current = null;
    };
  }, [sdkReady, startAlbum]);

  useEffect(() => {
    if (paused || duration <= 0) return;
    let lastTick = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      setPosition((current) => Math.min(current + now - lastTick, duration));
      lastTick = now;
    }, 500);
    return () => window.clearInterval(timer);
  }, [duration, paused]);

  function closePlayer() {
    pausePlayback();
    onClose();
  }

  const trackTitle = currentTrack?.name ?? currentAlbum.name;
  const trackArtists = currentTrack?.artists.map((artist) => artist.name).join(', ') ?? currentAlbum.artists.join(', ');
  const artwork = currentTrack?.album.images[0]?.url ?? currentAlbum.imageUrl;
  const controlsReady = Boolean(deviceIdRef.current && currentTrack);
  return (
    <>
      {scriptReady && (
        <Script
          id="spotify-web-playback-sdk"
          onError={() => setError('Could not load the Spotify Web Playback SDK.')}
          src="https://sdk.scdn.co/spotify-player.js"
          strategy="afterInteractive"
        />
      )}
      <aside aria-label="Spotify player" className="player-dock" hidden={hidden}>
        <div className="player-dock__header">
          <div className="player-dock__meta">
            <span className="player-dock__eyebrow">Now playing</span>
            <strong>{trackTitle}</strong>
            <span>{trackArtists}</span>
          </div>
          <button aria-label="Close Spotify player" className="icon-button" onClick={closePlayer} type="button">×</button>
        </div>

        <div className="player-dock__controls">
          {artwork ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="" className="player-dock__art" height="64" src={artwork} width="64" />
          ) : <div className="player-dock__art player-dock__art--empty" />}
          <button aria-label="Previous track" className="player-control" disabled={!controlsReady} onClick={() => void playerRef.current?.previousTrack().catch(reportCommandError)} type="button">‹</button>
          <button
            aria-label={paused ? 'Play' : 'Pause'}
            className="player-control player-control--primary"
            disabled={!controlsReady}
            onClick={() => void playerRef.current?.togglePlay().catch(reportCommandError)}
            type="button"
          >{paused ? '▶' : 'Ⅱ'}</button>
          <button aria-label="Next track" className="player-control" disabled={!controlsReady} onClick={() => void playerRef.current?.nextTrack().catch(reportCommandError)} type="button">›</button>
          <div className="player-progress">
            <span>{formatTime(position)}</span>
            <input
              aria-label="Playback position"
              disabled={!controlsReady}
              max={Math.max(duration, 1)}
              onChange={(event) => void playerRef.current?.seek(Number(event.target.value)).catch(reportCommandError)}
              type="range"
              value={Math.min(position, Math.max(duration, 1))}
            />
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {error && <p className="notice notice--error player-dock__error" role="alert">{error}</p>}
        <p aria-live="polite" className="player-dock__hint">{status}</p>
      </aside>
    </>
  );
});
