'use client';

import Script from 'next/script';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

import type { LibraryAlbum } from './cd-library-types';
import type { AlbumStartSource } from './listening-table-state';
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
  setVolume: (volume: number) => Promise<void>;
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

type AlbumEndBehavior = 'next' | 'repeat' | 'stop';

type PlaybackDevice = {
  id: string;
  isActive: boolean;
  name: string;
  supportsVolume: boolean;
  type: string;
  volumePercent: number | null;
};

type PlaybackSnapshot = WebPlaybackState & { deviceId: string | null };

type AlbumStartRequest = {
  album: LibraryAlbum;
  intent: number;
  resume: SavedSpotifyPlayback | null;
  source: AlbumStartSource;
};

const END_BEHAVIOR_KEY = 'spotify-cd-shelves.album-end.v1';
const VOLUME_KEY = 'spotify-cd-shelves.volume.v1';
const DEFAULT_VOLUME = 0.35;

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

function readEndBehavior(): AlbumEndBehavior {
  const saved = window.localStorage.getItem(END_BEHAVIOR_KEY);
  return saved === 'next' || saved === 'repeat' || saved === 'stop' ? saved : 'next';
}

function readVolume(): number {
  const raw = window.localStorage.getItem(VOLUME_KEY);
  if (raw === null) return DEFAULT_VOLUME;
  const saved = Number(raw);
  return Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : DEFAULT_VOLUME;
}

async function sendPlayerCommand(
  action: 'next' | 'pause' | 'previous' | 'repeat' | 'resume' | 'seek' | 'transfer' | 'volume',
  deviceId: string,
  values: { positionMs?: number; repeat?: 'context' | 'off'; volumePercent?: number } = {},
): Promise<void> {
  const response = await fetch('/api/player/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, deviceId, ...values }),
  });
  if (!response.ok) {
    const data = (await response.json()) as { error?: string };
    throw new Error(data.error || 'Spotify could not complete that command.');
  }
}

export const SpotifyPlayerDock = forwardRef<SpotifyPlayerHandle, {
  hidden?: boolean;
  initialAlbum: LibraryAlbum;
  initialPlayback?: SavedSpotifyPlayback | null;
  onClose: () => void;
  onPlayingAlbumChange: (albumId: string, source: AlbumStartSource) => void;
  shelfAlbums: LibraryAlbum[];
}>(function SpotifyPlayerDock({
  hidden = false,
  initialAlbum,
  initialPlayback = null,
  onClose,
  onPlayingAlbumChange,
  shelfAlbums,
}, ref) {
  const initialSavedTrack = initialPlayback?.albumId === initialAlbum.id
    ? initialAlbum.tracks.find((track) => track.id === initialPlayback.trackId)
    : undefined;
  const playerRef = useRef<SpotifyPlayer | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const pendingAlbumRef = useRef<AlbumStartRequest | null>(null);
  const playbackIntentRef = useRef(0);
  const outputDeviceIdRef = useRef<string | null>(null);
  const previousPositionRef = useRef(0);
  const previousTrackIdRef = useRef<string | null>(null);
  const handlingAlbumEndRef = useRef(false);
  const volumeRef = useRef(DEFAULT_VOLUME);
  const persistenceEnabledRef = useRef(true);
  const initialAlbumRef = useRef(initialAlbum);
  const currentAlbumRef = useRef(initialAlbumRef.current);
  const latestPlaybackRef = useRef<SavedSpotifyPlayback | null>(initialPlayback);
  const endBehaviorRef = useRef<AlbumEndBehavior>('next');
  const shelfAlbumsRef = useRef(shelfAlbums);
  const onPlayingAlbumChangeRef = useRef(onPlayingAlbumChange);
  const [currentAlbum, setCurrentAlbum] = useState(initialAlbumRef.current);
  const [currentTrack, setCurrentTrack] = useState<WebPlaybackTrack | null>(null);
  const [duration, setDuration] = useState(initialSavedTrack?.durationMs ?? 0);
  const [error, setError] = useState('');
  const [devices, setDevices] = useState<PlaybackDevice[]>([]);
  const [endBehavior, setEndBehavior] = useState<AlbumEndBehavior>('next');
  const [outputDeviceId, setOutputDeviceId] = useState<string | null>(null);
  const [paused, setPaused] = useState(true);
  const [position, setPosition] = useState(initialPlayback?.positionMs ?? 0);
  const [scriptReady, setScriptReady] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [resumePoint, setResumePoint] = useState<SavedSpotifyPlayback | null>(initialPlayback);
  const [status, setStatus] = useState('Connecting full player…');
  const [volume, setVolume] = useState(DEFAULT_VOLUME);

  shelfAlbumsRef.current = shelfAlbums;
  onPlayingAlbumChangeRef.current = onPlayingAlbumChange;

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

  const refreshDevices = useCallback(async (localDeviceId?: string) => {
    const response = await fetch('/api/player/devices', { cache: 'no-store' });
    if (!response.ok) return;
    const data = (await response.json()) as { devices?: PlaybackDevice[] };
    const available = Array.isArray(data.devices) ? data.devices : [];
    if (localDeviceId && !available.some((device) => device.id === localDeviceId)) {
      available.push({
        id: localDeviceId,
        isActive: false,
        name: 'Record Room (this browser)',
        supportsVolume: true,
        type: 'computer',
        volumePercent: Math.round(volumeRef.current * 100),
      });
    }
    setDevices(available);
    const current = outputDeviceIdRef.current;
    const selected = available.find((device) => device.id === current)
      ?? available.find((device) => device.isActive && device.id !== localDeviceId)
      ?? available.find((device) => device.id === localDeviceId)
      ?? available[0];
    if (selected && selected.id !== current) {
      outputDeviceIdRef.current = selected.id;
      setOutputDeviceId(selected.id);
      if (selected.id !== localDeviceId && selected.volumePercent !== null) {
        const nextVolume = selected.volumePercent / 100;
        volumeRef.current = nextVolume;
        setVolume(nextVolume);
      }
    }
    return selected?.id;
  }, []);

  const startAlbum = useCallback(async (
    request: AlbumStartRequest,
    deviceId: string,
  ) => {
    const { album, intent, resume, source } = request;
    const resumeTrack = resume?.albumId === album.id
      ? album.tracks.find((track) => track.id === resume.trackId)
      : undefined;
    currentAlbumRef.current = album;
    previousPositionRef.current = 0;
    previousTrackIdRef.current = null;
    handlingAlbumEndRef.current = false;
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
      onPlayingAlbumChangeRef.current(album.id, source);
      if (pendingAlbumRef.current?.intent === intent) pendingAlbumRef.current = null;
    } catch (playError) {
      if (intent !== playbackIntentRef.current) return;
      setError(playError instanceof Error ? playError.message : 'Spotify could not start this album.');
      setStatus('Playback unavailable');
    }
  }, []);

  const finishAlbum = useCallback(async () => {
    if (handlingAlbumEndRef.current) return;
    const behavior = endBehaviorRef.current;
    if (behavior === 'repeat') return;
    handlingAlbumEndRef.current = true;
    const deviceId = outputDeviceIdRef.current;
    if (!deviceId) return;

    if (behavior === 'next') {
      const albums = shelfAlbumsRef.current;
      const currentIndex = albums.findIndex((album) => album.id === currentAlbumRef.current.id);
      const nextAlbum = currentIndex >= 0 ? albums[currentIndex + 1] : undefined;
      if (nextAlbum) {
        const intent = playbackIntentRef.current + 1;
        playbackIntentRef.current = intent;
        await startAlbum({ album: nextAlbum, intent, resume: null, source: 'autoplay' }, deviceId);
        return;
      }
      setStatus('End of shelf');
    } else {
      setStatus('Album finished');
    }

    await sendPlayerCommand('pause', deviceId);
    await sendPlayerCommand('repeat', deviceId, { repeat: 'off' });
    setPaused(true);
  }, [startAlbum]);

  const applyPlaybackState = useCallback((state: PlaybackSnapshot) => {
    if (state.deviceId && state.deviceId !== outputDeviceIdRef.current) return;
    const track = state.track_window.current_track;
    const album = currentAlbumRef.current;
    const belongsToAlbum = album.tracks.some((albumTrack) => albumTrack.id === track.id);
    const firstTrackId = album.tracks[0]?.id;
    const lastTrackId = album.tracks.at(-1)?.id;
    const crossedAlbumBoundary = Boolean(
      previousTrackIdRef.current === lastTrackId &&
      (track.id === firstTrackId || !belongsToAlbum),
    ) || Boolean(
      album.tracks.length === 1 &&
      track.id === firstTrackId &&
      previousPositionRef.current > state.duration * 0.8 &&
      state.position < state.duration * 0.2,
    );

    if (crossedAlbumBoundary) void finishAlbum().catch(reportCommandError);
    previousTrackIdRef.current = track.id;
    previousPositionRef.current = state.position;
    if (!belongsToAlbum) return;

    setCurrentTrack(track);
    setDuration(state.duration);
    setPaused(state.paused);
    setPosition(state.position);
    persistPlayback({
      albumId: album.id,
      paused: state.paused,
      positionMs: state.position,
      trackId: track.id,
    });
    setResumePoint(latestPlaybackRef.current);
    setStatus(state.paused ? 'Paused' : 'Playing full track');
  }, [finishAlbum, persistPlayback, reportCommandError]);

  const pausePlayback = useCallback(() => {
    const intent = playbackIntentRef.current + 1;
    playbackIntentRef.current = intent;
    pendingAlbumRef.current = null;
    const deviceId = outputDeviceIdRef.current;
    if (!deviceId) return;
    void sendPlayerCommand('pause', deviceId)
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
      const request: AlbumStartRequest = { album, intent, resume, source: 'manual' };
      persistenceEnabledRef.current = true;
      pendingAlbumRef.current = request;
      currentAlbumRef.current = album;
      setCurrentAlbum(album);
      setResumePoint(resume);
      setError('');
      void playerRef.current?.activateElement().catch(reportCommandError);
      const deviceId = outputDeviceIdRef.current;
      if (deviceId) {
        void startAlbum(request, deviceId);
      } else {
        setStatus('Waiting for a Spotify device…');
      }
    },
  }), [pausePlayback, reportCommandError, startAlbum]);

  useEffect(() => {
    const savedBehavior = readEndBehavior();
    const savedVolume = readVolume();
    endBehaviorRef.current = savedBehavior;
    volumeRef.current = savedVolume;
    setEndBehavior(savedBehavior);
    setVolume(savedVolume);
    window.onSpotifyWebPlaybackSDKReady = () => setSdkReady(true);
    if (window.Spotify) setSdkReady(true);
    setScriptReady(true);
  }, []);

  useEffect(() => {
    if (!sdkReady || !window.Spotify) return;
    let cancelled = false;
    const player = new window.Spotify.Player({
      name: 'Record Room',
      volume: volumeRef.current,
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
      setStatus('Finding Spotify devices…');
      void refreshDevices(device_id).then((selectedDeviceId) => {
        if (cancelled) return;
        setStatus(latestPlaybackRef.current ? 'Ready to resume' : 'Full player ready');
        const pending = pendingAlbumRef.current;
        if (pending && selectedDeviceId) {
          void startAlbum(pending, selectedDeviceId);
        }
      });
    });
    player.addListener('not_ready', () => {
      deviceIdRef.current = null;
      setStatus('Player reconnecting…');
    });
    player.addListener('player_state_changed', (state: WebPlaybackState | null) => {
      if (!state) return;
      applyPlaybackState({ ...state, deviceId: deviceIdRef.current });
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
  }, [applyPlaybackState, refreshDevices, sdkReady, startAlbum]);

  useEffect(() => {
    if (!sdkReady) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch('/api/player/state', { cache: 'no-store' });
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as { playback?: null | {
          deviceId: string | null;
          duration: number;
          paused: boolean;
          position: number;
          track: WebPlaybackTrack;
        } };
        if (data.playback) {
          applyPlaybackState({
            deviceId: data.playback.deviceId,
            duration: data.playback.duration,
            paused: data.playback.paused,
            position: data.playback.position,
            track_window: { current_track: data.playback.track },
          });
        }
      } catch {
        // The SDK listener still controls local playback if polling is temporarily unavailable.
      }
    };
    void poll();
    const stateTimer = window.setInterval(() => void poll(), 1_500);
    const deviceTimer = window.setInterval(() => void refreshDevices(deviceIdRef.current ?? undefined), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(stateTimer);
      window.clearInterval(deviceTimer);
    };
  }, [applyPlaybackState, refreshDevices, sdkReady]);

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
  const selectedDevice = devices.find((device) => device.id === outputDeviceId);
  const deviceReady = Boolean(outputDeviceId);
  const controlsReady = Boolean(deviceReady && currentTrack);
  const canPlay = Boolean(deviceReady && (currentTrack || savedTrack));

  function toggleOrResume() {
    if (currentTrack) {
      const deviceId = outputDeviceIdRef.current;
      if (deviceId) void sendPlayerCommand(paused ? 'resume' : 'pause', deviceId).catch(reportCommandError);
      return;
    }
    const deviceId = deviceIdRef.current;
    if (!deviceId || !savedTrack || !resumePoint) return;
    const intent = playbackIntentRef.current + 1;
    playbackIntentRef.current = intent;
    void playerRef.current?.activateElement()
      .then(() => startAlbum({
        album: currentAlbum,
        intent,
        resume: resumePoint,
        source: 'manual',
      }, deviceId))
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
    const deviceId = outputDeviceIdRef.current;
    if (deviceId) void sendPlayerCommand('seek', deviceId, { positionMs }).catch(reportCommandError);
  }

  function changeEndBehavior(value: AlbumEndBehavior) {
    endBehaviorRef.current = value;
    setEndBehavior(value);
    window.localStorage.setItem(END_BEHAVIOR_KEY, value);
  }

  function changeOutput(deviceId: string) {
    outputDeviceIdRef.current = deviceId;
    setOutputDeviceId(deviceId);
    const device = devices.find((item) => item.id === deviceId);
    if (device?.volumePercent !== null && device?.volumePercent !== undefined && deviceId !== deviceIdRef.current) {
      const nextVolume = device.volumePercent / 100;
      volumeRef.current = nextVolume;
      setVolume(nextVolume);
    }
    if (deviceId === deviceIdRef.current) void playerRef.current?.activateElement().catch(reportCommandError);
    void sendPlayerCommand('transfer', deviceId).catch(reportCommandError);
  }

  function changeVolume(nextVolume: number) {
    volumeRef.current = nextVolume;
    setVolume(nextVolume);
    window.localStorage.setItem(VOLUME_KEY, String(nextVolume));
    const deviceId = outputDeviceIdRef.current;
    if (!deviceId) return;
    if (deviceId === deviceIdRef.current) {
      void playerRef.current?.setVolume(nextVolume).catch(reportCommandError);
    } else {
      void sendPlayerCommand('volume', deviceId, { volumePercent: Math.round(nextVolume * 100) }).catch(reportCommandError);
    }
  }

  function skipPlayback(action: 'next' | 'previous') {
    const deviceId = outputDeviceIdRef.current;
    if (deviceId) void sendPlayerCommand(action, deviceId).catch(reportCommandError);
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
          <button aria-label="Previous track" className="player-control" disabled={!controlsReady} onClick={() => skipPlayback('previous')} type="button">‹</button>
          <button
            aria-label={paused ? 'Play' : 'Pause'}
            className="player-control player-control--primary"
            disabled={!canPlay}
            onClick={toggleOrResume}
            type="button"
          >{paused ? '▶' : 'Ⅱ'}</button>
          <button aria-label="Next track" className="player-control" disabled={!controlsReady} onClick={() => skipPlayback('next')} type="button">›</button>
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

        <div className="player-dock__settings">
          <label>
            <span>After album</span>
            <select onChange={(event) => changeEndBehavior(event.target.value as AlbumEndBehavior)} value={endBehavior}>
              <option value="next">Next in shelf</option>
              <option value="repeat">Repeat album</option>
              <option value="stop">Stop</option>
            </select>
          </label>
          <label>
            <span>Output</span>
            <select
              disabled={devices.length === 0}
              onChange={(event) => changeOutput(event.target.value)}
              value={outputDeviceId ?? ''}
            >
              {devices.length === 0 && <option value="">Finding devices…</option>}
              {devices.map((device) => (
                <option key={device.id} value={device.id}>{device.name}</option>
              ))}
            </select>
          </label>
          <label className="player-volume">
            <span>Volume {Math.round(volume * 100)}%</span>
            <input
              aria-label="Playback volume"
              disabled={!selectedDevice?.supportsVolume && outputDeviceId !== deviceIdRef.current}
              max="1"
              min="0"
              onChange={(event) => changeVolume(Number(event.target.value))}
              step="0.01"
              type="range"
              value={volume}
            />
          </label>
        </div>

        {error && <p className="notice notice--error player-dock__error" role="alert">{error}</p>}
        <p aria-live="polite" className="player-dock__hint">{status}</p>
      </aside>
    </>
  );
});
