'use client';

import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type {
  AlbumDetail,
  AlbumSummary,
  AlbumTrack,
  AuthStatus,
  LibraryAlbum,
  SearchResponse,
} from './cd-library-types';
import { contrastColor, extractSpineColor } from '@/lib/spine-color';

const STORAGE_KEY = 'spotify-cd-shelves.library.v1';
const ALBUMS_PER_ROW = 12;
const MINIMUM_SHELF_ROWS = 3;

type RequestState = 'idle' | 'loading' | 'success' | 'error';

function readLibrary(): LibraryAlbum[] {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter(
          (album): album is LibraryAlbum =>
            typeof album === 'object' &&
            album !== null &&
            typeof (album as LibraryAlbum).id === 'string' &&
            typeof (album as LibraryAlbum).spineColor === 'string' &&
            Array.isArray((album as LibraryAlbum).tracks),
        )
      : [];
  } catch {
    return [];
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  try {
    const data = (await response.json()) as { error?: string; message?: string };
    return new Error(data.error || data.message || fallback);
  } catch {
    return new Error(fallback);
  }
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.round(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function chunkAlbums(albums: LibraryAlbum[]): LibraryAlbum[][] {
  const rows: LibraryAlbum[][] = [];
  for (let index = 0; index < albums.length; index += ALBUMS_PER_ROW) {
    rows.push(albums.slice(index, index + ALBUMS_PER_ROW));
  }
  while (rows.length < MINIMUM_SHELF_ROWS) rows.push([]);
  return rows;
}

function Icon({ name }: { name: 'add' | 'close' | 'music' | 'play' | 'search' | 'trash' }) {
  const paths = {
    add: <path d="M12 5v14M5 12h14" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    music: <path d="M9 18V5l10-2v13M9 18a3 3 0 1 1-3-3h3m10 1a3 3 0 1 1-3-3h3" />,
    play: <path d="m9 7 8 5-8 5V7Z" />,
    search: <path d="m20 20-4.2-4.2M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />,
    trash: <path d="M5 7h14M9 7V4h6v3m2 0-1 13H8L7 7m3 4v5m4-5v5" />,
  };
  return (
    <svg aria-hidden="true" className="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      {paths[name]}
    </svg>
  );
}

function LoadingSpinner({ label }: { label: string }) {
  return (
    <span className="loading-inline" role="status">
      <span aria-hidden="true" className="spinner" />
      <span>{label}</span>
    </span>
  );
}

function DialogShell({
  children,
  label,
  onClose,
  wide = false,
}: {
  children: React.ReactNode;
  label: string;
  onClose: () => void;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    const initialFocus = panelRef.current?.querySelector<HTMLElement>('[data-dialog-initial-focus]');
    (initialFocus ?? panelRef.current)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
      <div
        aria-label={label}
        aria-modal="true"
        className={`dialog-panel${wide ? ' dialog-panel--wide' : ''}`}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <button aria-label="Close dialog" className="icon-button dialog-close" onClick={onClose} type="button">
          <Icon name="close" />
        </button>
        {children}
      </div>
    </div>
  );
}

function SearchDialog({
  libraryIds,
  onAdd,
  onClose,
}: {
  libraryIds: Set<string>;
  onAdd: (album: AlbumSummary) => Promise<void>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AlbumSummary[]>([]);
  const [state, setState] = useState<RequestState>('idle');
  const [message, setMessage] = useState('');
  const [addingId, setAddingId] = useState<string | null>(null);

  async function add(album: AlbumSummary) {
    setAddingId(album.id);
    setMessage('');
    try {
      await onAdd(album);
    } catch (error) {
      setMessage(errorMessage(error, 'Could not add this album. Please try again.'));
    } finally {
      setAddingId(null);
    }
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setState('loading');
    setMessage('');
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
      if (!response.ok) throw await responseError(response, 'Spotify search failed. Please try again.');
      const data = (await response.json()) as SearchResponse;
      setResults(Array.isArray(data.albums) ? data.albums : []);
      setState('success');
    } catch (error) {
      setState('error');
      setMessage(errorMessage(error, 'Spotify search failed. Please try again.'));
    }
  }

  return (
    <DialogShell label="Add an album" onClose={onClose} wide>
      <div className="dialog-heading">
        <p className="eyebrow">Spotify catalogue</p>
        <h2>Add to your shelf</h2>
        <p>Search by artist or album title.</p>
      </div>
      <form className="search-form" onSubmit={search} role="search">
        <label className="sr-only" htmlFor="album-search">Search albums or artists</label>
        <div className="search-input-wrap">
          <Icon name="search" />
          <input
            autoFocus
            data-dialog-initial-focus
            id="album-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try “Kind of Blue” or “Björk”"
            type="search"
            value={query}
          />
        </div>
        <button className="button button--primary" disabled={!query.trim() || state === 'loading'} type="submit">
          {state === 'loading' ? 'Searching…' : 'Search'}
        </button>
      </form>

      <div aria-live="polite" className="search-results-status">
        {state === 'idle' && <p>Albums you add live only in this browser.</p>}
        {state === 'loading' && <LoadingSpinner label="Searching Spotify…" />}
        {(state === 'error' || message) && <p className="notice notice--error">{message}</p>}
        {state === 'success' && results.length === 0 && <p>No matching albums found. Try a broader search.</p>}
      </div>

      {results.length > 0 && (
        <ul className="search-results" aria-label="Album search results">
          {results.map((album) => {
            const isAdded = libraryIds.has(album.id);
            return (
              <li className="search-result" key={album.id}>
                {album.imageUrl ? (
                  // Spotify CDN hosts are runtime data, so a native image avoids a brittle host allowlist.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="" className="search-result__art" height="72" src={album.imageUrl} width="72" />
                ) : (
                  <div aria-hidden="true" className="search-result__art search-result__art--placeholder"><Icon name="music" /></div>
                )}
                <div className="search-result__copy">
                  <strong>{album.name}</strong>
                  <span>{album.artists.join(', ')}</span>
                  <small>{album.releaseDate?.slice(0, 4) || 'Release date unavailable'} · {album.totalTracks} tracks</small>
                </div>
                <button
                  className={`button ${isAdded ? 'button--added' : 'button--secondary'}`}
                  disabled={isAdded || addingId !== null}
                  onClick={() => void add(album)}
                  type="button"
                >
                  {isAdded ? 'On shelf' : addingId === album.id ? 'Adding…' : 'Add'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </DialogShell>
  );
}

function AlbumDialog({ album, onClose, onRemove }: { album: LibraryAlbum; onClose: () => void; onRemove: () => void }) {
  const tracks: AlbumTrack[] = album.tracks;
  const multipleDiscs = tracks.some((track) => track.discNumber > 1);

  return (
    <DialogShell label={`${album.name} by ${album.artists.join(', ')}`} onClose={onClose} wide>
      <div className="album-detail">
        <div className="album-detail__cover-wrap">
          {album.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={`${album.name} album cover`} className="album-detail__cover" src={album.imageUrl} />
          ) : (
            <div className="album-detail__cover album-detail__cover--placeholder"><Icon name="music" /></div>
          )}
        </div>
        <div className="album-detail__content">
          <div className="dialog-heading album-detail__heading">
            <p className="eyebrow">{album.releaseDate?.slice(0, 4) || 'Album'}</p>
            <h2>{album.name}</h2>
            <p>{album.artists.join(', ')}</p>
          </div>
          <div className="album-actions">
            <a className="button button--spotify" href={album.spotifyUrl} rel="noreferrer" target="_blank">
              <Icon name="play" /> Play on Spotify
            </a>
            <button className="button button--danger" onClick={onRemove} type="button">
              <Icon name="trash" /> Remove
            </button>
          </div>

          <div aria-live="polite" className="track-list-wrap">
            {tracks.length === 0 && <p className="notice">No track list is available.</p>}
            {tracks.length > 0 && (
              <ol className="track-list" aria-label="Track list">
                {tracks.map((track) => (
                  <li className="track" key={`${track.discNumber}-${track.id}`}>
                    <span className="track__number">{multipleDiscs ? `${track.discNumber}.` : ''}{track.trackNumber}</span>
                    <span className="track__name">{track.name}</span>
                    <span className="track__duration">{formatDuration(track.durationMs)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </DialogShell>
  );
}

function CdSpine({ album, onOpen }: { album: LibraryAlbum; onOpen: () => void }) {
  const background = album.spineColor;
  return (
    <button
      aria-label={`Open ${album.name} by ${album.artists.join(', ')}`}
      className="cd-spine"
      onClick={onOpen}
      style={{ backgroundColor: background, color: contrastColor(background) }}
      title={`${album.name} — ${album.artists.join(', ')}`}
      type="button"
    >
      <span className="cd-spine__shine" />
      <span className="cd-spine__artist">{album.artists.join(', ')}</span>
      <span className="cd-spine__title">{album.name}</span>
    </button>
  );
}

export function CdLibrary() {
  const [albums, setAlbums] = useState<LibraryAlbum[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authState, setAuthState] = useState<RequestState>('loading');
  const [authMessage, setAuthMessage] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<LibraryAlbum | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setAlbums(readLibrary());
      setHydrated(true);
    });
    const controller = new AbortController();
    async function checkAuth() {
      try {
        const response = await fetch('/api/auth/status', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw await responseError(response, 'Could not check Spotify connection.');
        const status = (await response.json()) as AuthStatus;
        setAuthenticated(Boolean(status.authenticated));
        setAuthState('success');
      } catch (error) {
        if (controller.signal.aborted) return;
        setAuthState('error');
        setAuthMessage(errorMessage(error, 'Could not check Spotify connection.'));
      }
    }
    void checkAuth();
    return () => {
      window.cancelAnimationFrame(frame);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(albums));
  }, [albums, hydrated]);

  const rows = useMemo(() => chunkAlbums(albums), [albums]);
  const libraryIds = useMemo(() => new Set(albums.map((album) => album.id)), [albums]);

  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const closeAlbum = useCallback(() => setSelectedAlbum(null), []);

  async function addAlbum(album: AlbumSummary) {
    if (libraryIds.has(album.id)) return;
    const response = await fetch(`/api/albums/${encodeURIComponent(album.id)}`);
    if (!response.ok) throw await responseError(response, 'Could not load the album details.');
    const data = (await response.json()) as AlbumDetail | { album: AlbumDetail };
    const detail = 'album' in data ? data.album : data;
    if (!detail || !Array.isArray(detail.tracks)) throw new Error('Spotify returned incomplete album details.');
    const spineColor = await extractSpineColor(detail);
    const savedAlbum: LibraryAlbum = { ...detail, spineColor };
    setAlbums((current) => current.some((item) => item.id === savedAlbum.id) ? current : [...current, savedAlbum]);
  }

  function removeSelectedAlbum() {
    if (!selectedAlbum) return;
    setAlbums((current) => current.filter((album) => album.id !== selectedAlbum.id));
    setSelectedAlbum(null);
  }

  async function logOut() {
    setAuthState('loading');
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw await responseError(response, 'Could not disconnect Spotify.');
      setAuthenticated(false);
      setAuthState('success');
      setSearchOpen(false);
    } catch (error) {
      setAuthState('error');
      setAuthMessage(errorMessage(error, 'Could not disconnect Spotify.'));
    }
  }

  function openSearch() {
    if (authenticated) setSearchOpen(true);
    else window.location.assign('/api/auth/login');
  }

  function handleSpineKeyDown(event: ReactKeyboardEvent, album: LibraryAlbum) {
    if (event.key === 'Enter' || event.key === ' ') setSelectedAlbum(album);
  }

  return (
    <main className="library-app">
      <header className="library-header">
        <div className="library-brand">
          <span aria-hidden="true" className="library-brand__mark"><Icon name="music" /></span>
          <div>
            <p className="eyebrow">Your collection</p>
            <h1>Record Room</h1>
          </div>
        </div>
        <div className="library-header__actions">
          {authState === 'loading' && <LoadingSpinner label="Connecting…" />}
          {authState !== 'loading' && authenticated && <span className="connection-status"><span /> Spotify connected</span>}
          {authenticated ? (
            <button className="button button--quiet" disabled={authState === 'loading'} onClick={() => void logOut()} type="button">Disconnect</button>
          ) : (
            <a className="button button--spotify" href="/api/auth/login">Connect Spotify</a>
          )}
          <button className="button button--primary library-add" onClick={openSearch} type="button"><Icon name="add" /> Add album</button>
        </div>
      </header>

      {authState === 'error' && <p className="notice notice--error auth-notice" role="alert">{authMessage}</p>}

      <section aria-label="CD library" className="shelf-cabinet">
        <div className="shelf-cabinet__top" />
        {rows.map((row, rowIndex) => (
          <div className="shelf-row" key={rowIndex}>
            <div className="shelf-row__back">
              <div className="shelf-row__contents">
                {row.map((album) => (
                  <div className="cd-spine-wrap" key={album.id} onKeyDown={(event) => handleSpineKeyDown(event, album)}>
                    <CdSpine album={album} onOpen={() => setSelectedAlbum(album)} />
                  </div>
                ))}
                {rowIndex === 0 && albums.length === 0 && hydrated && (
                  <div className="empty-shelf">
                    <span aria-hidden="true" className="empty-shelf__icon"><Icon name="music" /></span>
                    <div><strong>Your shelf is waiting.</strong><span>Connect Spotify, then add your first album.</span></div>
                    <button className="button button--secondary" onClick={openSearch} type="button">{authenticated ? 'Find an album' : 'Connect Spotify'}</button>
                  </div>
                )}
                {!hydrated && rowIndex === 0 && <div className="empty-shelf"><LoadingSpinner label="Opening your library…" /></div>}
              </div>
            </div>
            <div aria-hidden="true" className="shelf-plank"><span /></div>
          </div>
        ))}
        <div className="shelf-cabinet__base" />
      </section>

      <footer className="library-footer">
        <span>{albums.length} {albums.length === 1 ? 'album' : 'albums'}</span>
        <span>Stored locally in this browser</span>
      </footer>

      {searchOpen && <SearchDialog libraryIds={libraryIds} onAdd={addAlbum} onClose={closeSearch} />}
      {selectedAlbum && <AlbumDialog album={selectedAlbum} onClose={closeAlbum} onRemove={removeSelectedAlbum} />}
    </main>
  );
}

export default CdLibrary;
