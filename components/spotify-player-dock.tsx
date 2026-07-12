'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Script from 'next/script';

import type { LibraryAlbum } from './cd-library-types';

type SpotifyEmbedController = {
  addListener: (event: 'ready' | 'playback_started', listener: () => void) => void;
  destroy: () => void;
  loadEntity: (spotifyUriOrUrl: string) => void;
  pause: () => void;
  play: () => void;
};

type SpotifyIframeApi = {
  createController: (
    element: HTMLElement,
    options: { height: number; url: string; width: string },
    callback: (controller: SpotifyEmbedController) => void,
  ) => void;
};

export type SpotifyPlayerHandle = {
  pause: () => void;
  play: (album: LibraryAlbum) => void;
};

declare global {
  interface Window {
    __spotifyIframeApi?: SpotifyIframeApi;
    onSpotifyIframeApiReady?: (api: SpotifyIframeApi) => void;
  }
}

export const SpotifyPlayerDock = forwardRef<SpotifyPlayerHandle, {
  hidden?: boolean;
  initialAlbum: LibraryAlbum;
  onClose: () => void;
}>(function SpotifyPlayerDock({ hidden = false, initialAlbum, onClose }, ref) {
  const embedHostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<SpotifyEmbedController | null>(null);
  const controllerReadyRef = useRef(false);
  const pendingAlbumRef = useRef<LibraryAlbum | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const initialAlbumRef = useRef(initialAlbum);
  const [displayAlbum, setDisplayAlbum] = useState(initialAlbumRef.current);
  const [error, setError] = useState('');
  const [iframeApi, setIframeApi] = useState<SpotifyIframeApi | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [status, setStatus] = useState('Ready');

  const clearFallbackTimer = useCallback(() => {
    if (fallbackTimerRef.current !== null) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  const requestPlayback = useCallback((controller: SpotifyEmbedController, album: LibraryAlbum) => {
    controller.loadEntity(album.spotifyUrl);
    controller.play();
    setStatus('Starting playback…');
    clearFallbackTimer();
    fallbackTimerRef.current = window.setTimeout(() => {
      setStatus('Press play in the Spotify controls if playback was blocked.');
    }, 1800);
  }, [clearFallbackTimer]);

  const pausePlayback = useCallback(() => {
    clearFallbackTimer();
    controllerRef.current?.pause();
    setStatus('Paused');
  }, [clearFallbackTimer]);

  useImperativeHandle(ref, () => ({
    pause: pausePlayback,
    play(album) {
      setDisplayAlbum(album);
      const controller = controllerRef.current;
      if (controller && controllerReadyRef.current) {
        requestPlayback(controller, album);
      } else {
        pendingAlbumRef.current = album;
        setStatus('Loading player…');
      }
    },
  }), [pausePlayback, requestPlayback]);

  useEffect(() => {
    let cancelled = false;
    if (window.__spotifyIframeApi) {
      setIframeApi(window.__spotifyIframeApi);
    }
    window.onSpotifyIframeApiReady = (api) => {
      window.__spotifyIframeApi = api;
      if (!cancelled) setIframeApi(api);
    };
    setScriptReady(true);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!iframeApi) return;
    let cancelled = false;
    const host = embedHostRef.current;
    if (!host) return;

    iframeApi.createController(
      host,
      { height: 152, url: initialAlbumRef.current.spotifyUrl, width: '100%' },
      (controller) => {
        if (cancelled) {
          controller.destroy();
          return;
        }
        controllerRef.current = controller;
        controller.addListener('ready', () => {
          controllerReadyRef.current = true;
          const pendingAlbum = pendingAlbumRef.current;
          if (pendingAlbum) {
            pendingAlbumRef.current = null;
            requestPlayback(controller, pendingAlbum);
          } else {
            setStatus('Ready');
          }
        });
        controller.addListener('playback_started', () => {
          clearFallbackTimer();
          setStatus('Playing');
        });
      },
    );

    return () => {
      cancelled = true;
      clearFallbackTimer();
      controllerRef.current?.destroy();
      controllerRef.current = null;
      controllerReadyRef.current = false;
    };
  }, [clearFallbackTimer, iframeApi, requestPlayback]);

  function closePlayer() {
    pausePlayback();
    onClose();
  }

  return (
    <>
      {scriptReady && (
        <Script
          id="spotify-iframe-api"
          onError={() => setError('Could not load the Spotify player.')}
          src="https://open.spotify.com/embed/iframe-api/v1"
          strategy="afterInteractive"
        />
      )}
      <aside aria-label="Spotify player" className="player-dock" hidden={hidden}>
        <div className="player-dock__header">
          <div className="player-dock__meta">
            <span className="player-dock__eyebrow">Now playing</span>
            <strong>{displayAlbum.name}</strong>
            <span>{displayAlbum.artists.join(', ')}</span>
          </div>
          <button aria-label="Close Spotify player" className="icon-button" onClick={closePlayer} type="button">
            <svg aria-hidden="true" className="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        {error ? (
          <p className="notice notice--error">{error}</p>
        ) : (
          <div className="player-dock__embed" ref={embedHostRef} />
        )}
        <p aria-live="polite" className="player-dock__hint">{status}</p>
      </aside>
    </>
  );
});
