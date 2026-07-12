'use client';

import Script from 'next/script';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

import type { LibraryAlbum } from './cd-library-types';
import {
  readSavedSpotifyPlayback,
  saveSpotifyPlayback,
  type SavedSpotifyPlayback,
} from './spotify-playback-storage';

type WebPlaybackTrack = {
  album: { images: Array<{ url: string }> };
  artists: Array<{ name: string }>;
  id: string;
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
  forget: () => void;
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
  initialPlayback?: SavedSpotifyPlayback | null;
  onClose: () => void;
}>(function SpotifyPlayerDock({ hidden = false, initialAlbum, initialPlayback = null, onClose }, ref) {
  const initialSavedTrack = initialPlayback?.albumId === initialAlbum.id
    ? initialAlbum.tracks.find((track) => track.id === initialPlayback.trackId)
    : undefined;
  const playerRef = useRef<SpotifyPlayer | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const pendingAlbumRef = useRef<{
    album: LibraryAlbum;
    intent: number;
    resume: SavedSpotifyPlayback | null;
  } | null>(null);
  const playbackIntentRef = useRef(0);
  const persistenceEnabledRef = useRef(true);
  const initialAlbumRef = useRef(initialAlbum);
  const currentAlbumRef = useRef(initialAlbumRef.current);
  const latestPlaybackRef = useRef<SavedSpotifyPlayback | null>(initialPlayback);
  const [currentAlbum, setCurrentAlbum] = useState(initialAlbumRef.current);
  const [currentTrack, setCurrentTrack] = useState<WebPlaybackTrack | null>(null);
  const [duration, setDuration] = useState(initialSavedTrack?.durationMs ?? 0);
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(true);
  const [position, setPosition] = useState(initialPlayback?.positionMs ?? 0);
  const [scriptReady, setScriptReady] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [resumePoint, setResumePoint] = useState<SavedSpotifyPlayback | null>(initialPlayback);
  const [status, setStatus] = useState('Connecting full player…');

  const reportCommandError = useCallback((commandError: unknown) => {
    setError(commandError instanceof Error ? commandError.message : 'Spotify could not complete that command.');
    setStatus('Playback unavailable');
  }, []);

  const persistPlayback = useCallback((
    playback: Omit<SavedSpotifyPlayback, 'updatedAt'> | SavedSpotifyPlayback | null,
  ) => {
    if (!playback || !persistenceEnabledRef.current) return;
    const saved: SavedSpotifyPlayback = { ...playback, updatedAt: Date.now() };
    latestPlaybackRef.current = saved;
    saveSpotifyPlayback(saved);
  }, []);

  const startAlbum = useCallback(async (
    album: LibraryAlbum,
    deviceId: string,
    intent: number,
    resume: SavedSpotifyPlayback | null,
  ) => {
    const resumeTrack = resume?.albumId === album.id
      ? album.tracks.find((track) => track.id === resume.trackId)
      : undefined;
    currentAlbumRef.current = album;
    setCurrentAlbum(album);
    setCurrentTrack(null);
    setDuration(resumeTrack?.durationMs ?? 0);
    setPaused(true);
    setPosition(resume?.albumId === album.id ? resume.positionMs : 0);
    setResumePoint(resume?.albumId === album.id ? resume : null);
    setStatus('Starting album…');
    setError('');
    try {
      const response = await fetch('/api/player/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          albumId: album.id,
          deviceId,
          ...(resume?.albumId === album.id
            ? { positionMs: resume.positionMs, trackId: resume.trackId }
            : {}),
        }),
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
        if (latestPlaybackRef.current) {
          persistPlayback({
            ...latestPlaybackRef.current,
            paused: true,
          });
        }
        setPaused(true);
        setStatus('Paused');
      })
      .catch((commandError: unknown) => {
        if (intent === playbackIntentRef.current) reportCommandError(commandError);
      });
  }, [persistPlayback, reportCommandError]);

  useImperativeHandle(ref, () => ({
    forget() {
      persistenceEnabledRef.current = false;
      latestPlaybackRef.current = null;
      pendingAlbumRef.current = null;
      setResumePoint(null);
    },
    pause: pausePlayback,
    play(album) {
      const intent = playbackIntentRef.current + 1;
      playbackIntentRef.current = intent;
      const saved = readSavedSpotifyPlayback();
      const resume = saved?.albumId === album.id ? saved : null;
      persistenceEnabledRef.current = true;
      pendingAlbumRef.current = { album, intent, resume };
      currentAlbumRef.current = album;
      setCurrentAlbum(album);
      setResumePoint(resume);
      setError('');
      void playerRef.current?.activateElement().catch(reportCommandError);
      const deviceId = deviceIdRef.current;
      if (deviceId) {
        void startAlbum(album, deviceId, intent, resume);
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
        void startAlbum(pending.album, device_id, pending.intent, pending.resume);
      } else if (latestPlaybackRef.current) {
        setStatus('Ready to resume');
      }
    });
    player.addListener('not_ready', () => {
      deviceIdRef.current = null;
      setStatus('Player reconnecting…');
    });
    player.addListener('player_state_changed', (state: WebPlaybackState | null) => {
      if (!state) return;
      const track = state.track_window.current_track;
      const album = currentAlbumRef.current;
      const belongsToAlbum = album.tracks.some((albumTrack) => albumTrack.id === track.id);
      setCurrentTrack(track);
      setDuration(state.duration);
      setPaused(state.paused);
      setPosition(state.position);
      if (belongsToAlbum) {
        persistPlayback({
          albumId: album.id,
          paused: state.paused,
          positionMs: state.position,
          trackId: track.id,
        });
        setResumePoint(latestPlaybackRef.current);
      }
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
  }, [persistPlayback, sdkReady, startAlbum]);

  useEffect(() => {
    if (paused || duration <= 0) return;
    let lastTick = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      setPosition((current) => {
        const next = Math.min(current + now - lastTick, duration);
        if (latestPlaybackRef.current) {
          latestPlaybackRef.current = {
            ...latestPlaybackRef.current,
            paused: false,
            positionMs: next,
            updatedAt: now,
          };
        }
        return next;
      });
      lastTick = now;
    }, 500);
    return () => window.clearInterval(timer);
  }, [duration, paused]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      persistPlayback(latestPlaybackRef.current);
    }, 5_000);
    const persistLatest = () => persistPlayback(latestPlaybackRef.current);
    const persistWhenHidden = () => {
      if (document.visibilityState === 'hidden') persistLatest();
    };
    window.addEventListener('pagehide', persistLatest);
    document.addEventListener('visibilitychange', persistWhenHidden);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pagehide', persistLatest);
      document.removeEventListener('visibilitychange', persistWhenHidden);
      persistLatest();
    };
  }, [persistPlayback]);

  function closePlayer() {
    pausePlayback();
    onClose();
  }

  const savedTrack = resumePoint?.albumId === currentAlbum.id
    ? currentAlbum.tracks.find((track) => track.id === resumePoint.trackId)
    : undefined;
  const trackTitle = currentTrack?.name ?? savedTrack?.name ?? currentAlbum.name;
  const trackArtists = currentTrack?.artists.map((artist) => artist.name).join(', ') ?? currentAlbum.artists.join(', ');
  const artwork = currentTrack?.album.images[0]?.url ?? currentAlbum.imageUrl;
  const deviceReady = Boolean(deviceIdRef.current);
  const controlsReady = Boolean(deviceReady && currentTrack);
  const canPlay = Boolean(deviceReady && (currentTrack || savedTrack));

  function toggleOrResume() {
    if (currentTrack) {
      void playerRef.current?.togglePlay().catch(reportCommandError);
      return;
    }
    const deviceId = deviceIdRef.current;
    if (!deviceId || !savedTrack || !resumePoint) return;
    const intent = playbackIntentRef.current + 1;
    playbackIntentRef.current = intent;
    void playerRef.current?.activateElement()
      .then(() => startAlbum(currentAlbum, deviceId, intent, resumePoint))
      .catch(reportCommandError);
  }

  function seekPlayback(positionMs: number) {
    setPosition(positionMs);
    if (latestPlaybackRef.current) {
      persistPlayback({
        ...latestPlaybackRef.current,
        positionMs,
      });
    }
    void playerRef.current?.seek(positionMs).catch(reportCommandError);
  }
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
            disabled={!canPlay}
            onClick={toggleOrResume}
            type="button"
          >{paused ? '▶' : 'Ⅱ'}</button>
          <button aria-label="Next track" className="player-control" disabled={!controlsReady} onClick={() => void playerRef.current?.nextTrack().catch(reportCommandError)} type="button">›</button>
          <div className="player-progress">
            <span>{formatTime(position)}</span>
            <input
              aria-label="Playback position"
              disabled={!controlsReady}
              max={Math.max(duration, 1)}
              onChange={(event) => seekPlayback(Number(event.target.value))}
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
