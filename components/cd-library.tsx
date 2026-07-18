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
import { SpotifyPlayerDock, type SpotifyPlayerHandle } from './spotify-player-dock';
import {
  clearSavedSpotifyPlayback,
  readSavedSpotifyPlayback,
  type SavedSpotifyPlayback,
} from './spotify-playback-storage';
import {
  createLibraryExport,
  isStoredLibraryAlbum,
  mergeAlbumsPreferImported,
  normalizeAlbumAddedAt,
  parseLibraryExport,
} from './library-transfer';
import {
  LIBRARY_SORT_OPTIONS,
  sortLibraryAlbums,
  type LibrarySort,
} from './library-sort';
import {
  addAlbumToTable,
  normalizeTableAlbumIds,
  returnAlbumToShelf,
} from './listening-table-state';

const STORAGE_KEY = 'spotify-cd-shelves.library.v1';
const TABLE_STORAGE_KEY = 'spotify-cd-shelves.listening-table.v1';
const DEFAULT_ALBUMS_PER_ROW = 12;
const MINIMUM_SHELF_ROWS = 3;

type RequestState = 'idle' | 'loading' | 'success' | 'error';

function readLibrary(): LibraryAlbum[] {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? normalizeAlbumAddedAt(parsed.filter(isStoredLibraryAlbum))
      : [];
  } catch {
    return [];
  }
}

function readTableAlbumIds(libraryAlbumIds: string[]): string[] {
  try {
    const value = window.localStorage.getItem(TABLE_STORAGE_KEY);
    return normalizeTableAlbumIds(value ? JSON.parse(value) : [], libraryAlbumIds);
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

function chunkAlbums(albums: LibraryAlbum[], albumsPerRow: number): LibraryAlbum[][] {
  const rows: LibraryAlbum[][] = [];
  for (let index = 0; index < albums.length; index += albumsPerRow) {
    rows.push(albums.slice(index, index + albumsPerRow));
  }
  while (rows.length < MINIMUM_SHELF_ROWS) rows.push([]);
  return rows;
}

function Icon({ name }: { name: 'add' | 'close' | 'music' | 'play' | 'return' | 'search' | 'trash' }) {
  const paths = {
    add: <path d="M12 5v14M5 12h14" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    music: <path d="M9 18V5l10-2v13M9 18a3 3 0 1 1-3-3h3m10 1a3 3 0 1 1-3-3h3" />,
    play: <path d="m9 7 8 5-8 5V7Z" />,
    return: <path d="M9 7 4 12l5 5M5 12h10a5 5 0 0 1 5 5M4 20h16" />,
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
          'a[href], button:not([disabled]), input:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])',
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

function AlbumDialog({
  album,
  onClose,
  onPlay,
  onRemove,
  onReturnToShelf,
}: {
  album: LibraryAlbum;
  onClose: () => void;
  onPlay: () => void;
  onRemove: () => void;
  onReturnToShelf?: () => void;
}) {
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
            <button className="button button--spotify" onClick={onPlay} type="button">
              <Icon name="play" /> Play now
            </button>
            {onReturnToShelf && (
              <button className="button button--secondary" onClick={onReturnToShelf} type="button">
                <Icon name="return" /> Return to shelf
              </button>
            )}
            <a className="button button--secondary" href={album.spotifyUrl} rel="noreferrer" target="_blank">Open in Spotify</a>
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

function ImportDialog({
  albumCount,
  currentAlbumCount,
  fileName,
  onClose,
  onMerge,
  onReplace,
}: {
  albumCount: number;
  currentAlbumCount: number;
  fileName: string;
  onClose: () => void;
  onMerge: () => void;
  onReplace: () => void;
}) {
  return (
    <DialogShell label="Import library" onClose={onClose}>
      <div className="dialog-heading">
        <p className="eyebrow">Library import</p>
        <h2>How should this library be imported?</h2>
        <p>
          {fileName} contains {albumCount} {albumCount === 1 ? 'album' : 'albums'}. Your current library has{' '}
          {currentAlbumCount}.
        </p>
      </div>
      <div className="import-actions">
        <button className="button button--primary" data-dialog-initial-focus onClick={onMerge} type="button">
          Merge libraries
        </button>
        <button className="button button--danger" onClick={onReplace} type="button">
          Replace library
        </button>
        <button className="button button--quiet" onClick={onClose} type="button">Cancel</button>
      </div>
      <p className="notice">
        Merge keeps your shelf and updates matching albums from the file. Replace restores the file exactly.
      </p>
    </DialogShell>
  );
}

function AlbumSpineLabel({
  album,
  variant,
}: {
  album: LibraryAlbum;
  variant: 'shelf' | 'table';
}) {
  const prefix = variant === 'shelf' ? 'cd-spine' : 'table-album';

  return (
    <span className={`${prefix}__label`}>
      <span className={`${prefix}__artist`}>{album.artists.join(', ')}</span>
      <span className={`${prefix}__title`}>{album.name}</span>
    </span>
  );
}

function CdSpine({ album, onOpen }: { album: LibraryAlbum; onOpen: () => void }) {
  const background = album.spineColor;
  return (
    <button
      aria-label={`Open ${album.name} by ${album.artists.join(', ')}`}
      className="cd-spine"
      data-spine-label={`${album.artists.join(', ')} — ${album.name}`}
      onClick={onOpen}
      style={{ color: contrastColor(background) }}
      title={`${album.name} — ${album.artists.join(', ')}`}
      type="button"
    >
      <span className="cd-spine__case" style={{ backgroundColor: background }}>
        <span className="cd-spine__shine" />
        <AlbumSpineLabel album={album} variant="shelf" />
      </span>
    </button>
  );
}

function ShelfPlaceholder({ album }: { album: LibraryAlbum }) {
  const background = album.spineColor;

  return (
    <span
      aria-label={`${album.name} by ${album.artists.join(', ')} is on the listening table`}
      className="cd-spine-placeholder"
      role="img"
      style={{ color: contrastColor(background) }}
      title={`${album.name} is on the listening table`}
    >
      <span className="cd-spine-placeholder__line" style={{ backgroundColor: background }}>
        <span className="cd-spine-placeholder__shine" />
        <AlbumSpineLabel album={album} variant="shelf" />
      </span>
    </span>
  );
}

function ListeningTable({
  albums,
  activeAlbumId,
  onCleanUp,
  onOpenAlbum,
}: {
  albums: LibraryAlbum[];
  activeAlbumId: string | null;
  onCleanUp: () => void;
  onOpenAlbum: (album: LibraryAlbum) => void;
}) {
  const topAlbum = albums.at(-1);
  const stackStep = Math.min(10.5, 220 / Math.max(albums.length - 1, 1));

  return (
    <aside aria-label="Listening table" className="listening-table">
      <div className="listening-table__heading">
        <div>
          <p className="eyebrow">Now spinning</p>
          <h2>Listening table</h2>
        </div>
        <button
          className="button button--quiet listening-table__cleanup"
          disabled={albums.length === 0}
          onClick={onCleanUp}
          type="button"
        >
          <Icon name="return" /> Clean up
        </button>
      </div>

      <div className="listening-table__scene">
        <div aria-hidden="true" className={`retro-player${activeAlbumId ? ' retro-player--active' : ''}`}>
          <div className="retro-player__handle" />
          <div className="retro-player__face">
            <span className="retro-player__speaker" />
            <div className="retro-player__display">
              <span>{activeAlbumId ? 'PLAY' : 'READY'}</span>
              <strong>{activeAlbumId ? '02' : '--'}</strong>
            </div>
            <span className="retro-player__tray"><i /></span>
            <div className="retro-player__buttons"><i /><i /><i /><i /></div>
            <span className="retro-player__knob" />
          </div>
        </div>

        <div className="table-album-stack" aria-label={`${albums.length} albums on the table`}>
          {albums.length === 0 && (
            <div className="table-album-stack__empty">
              <Icon name="music" />
              <span>Play an album and leave the case here.</span>
            </div>
          )}
          {albums.map((album, index) => (
            <button
              aria-label={`Open ${album.name} by ${album.artists.join(', ')} on the listening table`}
              className={`table-album${album.id === activeAlbumId ? ' table-album--active' : ''}`}
              key={album.id}
              onClick={() => onOpenAlbum(album)}
              style={{
                backgroundColor: album.spineColor,
                color: contrastColor(album.spineColor),
                '--stack-index': index,
                '--stack-offset': `${index * stackStep}px`,
                '--stack-shift': `${((index % 5) - 2) * 1.25}px`,
              } as React.CSSProperties}
              title={`${album.name} — ${album.artists.join(', ')}`}
              type="button"
            >
              <span aria-hidden="true" className="table-album__case-edge" />
              <span aria-hidden="true" className="table-album__shine" />
              <AlbumSpineLabel album={album} variant="table" />
            </button>
          ))}
        </div>

        <div aria-hidden="true" className="listening-table__furniture">
          <span className="listening-table__top" />
          <span className="listening-table__apron" />
          <span className="listening-table__leg listening-table__leg--left" />
          <span className="listening-table__leg listening-table__leg--right" />
        </div>
      </div>

      <p aria-live="polite" className="listening-table__caption">
        {topAlbum
          ? `${topAlbum.name} is on top of ${albums.length === 1 ? 'the stack' : `${albums.length} albums`}.`
          : 'The table is tidy.'}
      </p>
    </aside>
  );
}

export function CdLibrary() {
  const [albums, setAlbums] = useState<LibraryAlbum[]>([]);
  const [tableAlbumIds, setTableAlbumIds] = useState<string[]>([]);
  const [albumsPerRow, setAlbumsPerRow] = useState(DEFAULT_ALBUMS_PER_ROW);
  const [librarySort, setLibrarySort] = useState<LibrarySort>('shelf');
  const [hydrated, setHydrated] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [playbackReady, setPlaybackReady] = useState(false);
  const [authState, setAuthState] = useState<RequestState>('loading');
  const [authMessage, setAuthMessage] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<LibraryAlbum | null>(null);
  const shelfRef = useRef<HTMLElement>(null);
  const playerRef = useRef<SpotifyPlayerHandle>(null);
  const [activePlayerAlbumId, setActivePlayerAlbumId] = useState<string | null>(null);
  const [savedPlayback, setSavedPlayback] = useState<SavedSpotifyPlayback | null>(null);
  const [playerVisible, setPlayerVisible] = useState(true);
  const [transferMessage, setTransferMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [pendingImport, setPendingImport] = useState<{ albums: LibraryAlbum[]; fileName: string } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const library = readLibrary();
      const playback = readSavedSpotifyPlayback();
      const savedAlbum = playback
        ? library.find(
            (album) =>
              album.id === playback.albumId &&
              album.tracks.some((track) => track.id === playback.trackId),
          )
        : undefined;
      if (playback && !savedAlbum) clearSavedSpotifyPlayback();
      setAlbums(library);
      setTableAlbumIds(readTableAlbumIds(library.map((album) => album.id)));
      setSavedPlayback(savedAlbum ? playback : null);
      setActivePlayerAlbumId(savedAlbum?.id ?? null);
      setHydrated(true);
    });
    const controller = new AbortController();
    async function checkAuth() {
      try {
        const response = await fetch('/api/auth/status', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw await responseError(response, 'Could not check Spotify connection.');
        const status = (await response.json()) as AuthStatus;
        setAuthenticated(Boolean(status.authenticated));
        setPlaybackReady(Boolean(status.playbackReady));
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

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(TABLE_STORAGE_KEY, JSON.stringify(tableAlbumIds));
  }, [hydrated, tableAlbumIds]);

  useEffect(() => {
    const shelf = shelfRef.current;
    const shelfBack = shelf?.querySelector<HTMLElement>('.shelf-row__back');
    if (!shelf || !shelfBack) return;
    const shelfElement = shelf;
    const shelfBackElement = shelfBack;

    function updateAlbumsPerRow() {
      const shelfStyles = window.getComputedStyle(shelfElement);
      const rowStyles = window.getComputedStyle(shelfBackElement);
      const spineWidth = Number.parseFloat(shelfStyles.getPropertyValue('--cd-cell-width'));
      const horizontalPadding = Number.parseFloat(rowStyles.paddingLeft) + Number.parseFloat(rowStyles.paddingRight);
      const availableWidth = shelfBackElement.clientWidth - horizontalPadding;

      if (!Number.isFinite(spineWidth) || spineWidth <= 0 || availableWidth <= 0) return;
      const capacity = Math.max(1, Math.floor(availableWidth / spineWidth));
      setAlbumsPerRow((current) => current === capacity ? current : capacity);
    }

    updateAlbumsPerRow();
    const observer = new ResizeObserver(updateAlbumsPerRow);
    observer.observe(shelfBackElement);
    return () => observer.disconnect();
  }, []);

  const displayedAlbums = useMemo(() => sortLibraryAlbums(albums, librarySort), [albums, librarySort]);
  const rows = useMemo(() => chunkAlbums(displayedAlbums, albumsPerRow), [displayedAlbums, albumsPerRow]);
  const libraryIds = useMemo(() => new Set(albums.map((album) => album.id)), [albums]);
  const tableAlbumIdSet = useMemo(() => new Set(tableAlbumIds), [tableAlbumIds]);
  const tableAlbums = useMemo(
    () => tableAlbumIds
      .map((albumId) => albums.find((album) => album.id === albumId))
      .filter((album): album is LibraryAlbum => Boolean(album)),
    [albums, tableAlbumIds],
  );

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
    const savedAlbum: LibraryAlbum = { ...detail, addedAt: new Date().toISOString(), spineColor };
    setAlbums((current) => current.some((item) => item.id === savedAlbum.id) ? current : [...current, savedAlbum]);
  }

  function removeSelectedAlbum() {
    if (!selectedAlbum) return;
    if (selectedAlbum.id === activePlayerAlbumId) {
      playerRef.current?.pause();
      playerRef.current?.forget();
      clearSavedSpotifyPlayback(selectedAlbum.id);
      setSavedPlayback(null);
      setActivePlayerAlbumId(null);
      setPlayerVisible(false);
    }
    setAlbums((current) => current.filter((album) => album.id !== selectedAlbum.id));
    setTableAlbumIds((current) => returnAlbumToShelf(current, selectedAlbum.id));
    setSelectedAlbum(null);
  }

  function playSelectedAlbum() {
    if (!selectedAlbum) return;
    if (!playbackReady) {
      window.location.assign('/api/auth/login');
      return;
    }
    playerRef.current?.play(selectedAlbum);
    setActivePlayerAlbumId(selectedAlbum.id);
    setPlayerVisible(true);
    setSelectedAlbum(null);
  }

  function returnSelectedAlbumToShelf() {
    if (!selectedAlbum) return;
    setTableAlbumIds((current) => returnAlbumToShelf(current, selectedAlbum.id));
    setSelectedAlbum(null);
  }

  const handlePlayingAlbumChange = useCallback((albumId: string) => {
    setActivePlayerAlbumId(albumId);
    setTableAlbumIds((current) => addAlbumToTable(current, albumId));
  }, []);

  async function logOut() {
    setAuthState('loading');
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw await responseError(response, 'Could not disconnect Spotify.');
      setAuthenticated(false);
      setPlaybackReady(false);
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

  function exportLibrary() {
    const contents = createLibraryExport(albums);
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `record-room-library-${new Date().toISOString().slice(0, 10)}.json`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setTransferMessage({
      kind: 'success',
      text: `Exported ${albums.length} ${albums.length === 1 ? 'album' : 'albums'}.`,
    });
  }

  async function importLibrary(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!hydrated) return;

    try {
      const imported = parseLibraryExport(await file.text());
      setPendingImport({ albums: imported, fileName: file.name });
      setTransferMessage(null);
    } catch (error) {
      setTransferMessage({ kind: 'error', text: errorMessage(error, 'Could not import this library.') });
    }
  }

  function finishImport(mode: 'merge' | 'replace') {
    if (!pendingImport) return;
    const imported = pendingImport.albums;
    let message: string;

    if (mode === 'merge') {
      setAlbums((current) => mergeAlbumsPreferImported(current, imported));
      message = `Merged ${imported.length} ${imported.length === 1 ? 'album' : 'albums'}; matching albums were updated.`;
    } else {
      if (activePlayerAlbumId && !imported.some((album) => album.id === activePlayerAlbumId)) {
        playerRef.current?.pause();
        playerRef.current?.forget();
        clearSavedSpotifyPlayback(activePlayerAlbumId);
        setSavedPlayback(null);
        setActivePlayerAlbumId(null);
        setPlayerVisible(false);
      }
      setSelectedAlbum(null);
      setTableAlbumIds((current) => normalizeTableAlbumIds(current, imported.map((album) => album.id)));
      setAlbums(imported);
      message = `Replaced the library with ${imported.length} ${imported.length === 1 ? 'album' : 'albums'}.`;
    }

    setPendingImport(null);
    setTransferMessage({ kind: 'success', text: message });
  }

  function handleSpineKeyDown(event: ReactKeyboardEvent, album: LibraryAlbum) {
    if (event.key === 'Enter' || event.key === ' ') setSelectedAlbum(album);
  }

  const playerAlbum =
    albums.find((album) => album.id === activePlayerAlbumId) ?? albums[0];

  return (
    <main className={`library-app${albums.length > 0 && playbackReady && playerVisible ? ' library-app--player-open' : ''}`}>
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
          {authState !== 'loading' && authenticated && (
            <span className="connection-status"><span /> {playbackReady ? 'Full playback authorized' : 'Spotify connected'}</span>
          )}
          {authenticated && !playbackReady && (
            <a className="button button--spotify" href="/api/auth/login">Enable full player</a>
          )}
          {authenticated ? (
            <button className="button button--quiet" disabled={authState === 'loading'} onClick={() => void logOut()} type="button">Disconnect</button>
          ) : (
            <a className="button button--spotify" href="/api/auth/login">Connect Spotify</a>
          )}
          <input
            accept="application/json,.json"
            hidden
            onChange={(event) => void importLibrary(event)}
            ref={importInputRef}
            type="file"
          />
          <button className="button button--quiet" disabled={!hydrated} onClick={() => importInputRef.current?.click()} type="button">Import</button>
          <button className="button button--quiet" disabled={!hydrated || albums.length === 0} onClick={exportLibrary} type="button">Export</button>
          <button className="button button--primary library-add" onClick={openSearch} type="button"><Icon name="add" /> Add album</button>
        </div>
      </header>

      {authState === 'error' && <p className="notice notice--error auth-notice" role="alert">{authMessage}</p>}
      {transferMessage && (
        <div
          aria-live="polite"
          className={`transfer-notice${transferMessage.kind === 'error' ? ' transfer-notice--error' : ''}`}
          role={transferMessage.kind === 'error' ? 'alert' : 'status'}
        >
          <span>{transferMessage.text}</span>
          <button aria-label="Dismiss import or export message" className="icon-button" onClick={() => setTransferMessage(null)} type="button">
            <Icon name="close" />
          </button>
        </div>
      )}

      {hydrated && albums.length > 1 && (
        <div className="library-toolbar">
          <label className="sort-control" htmlFor="library-sort">
            <span>Sort by</span>
            <select
              id="library-sort"
              onChange={(event) => setLibrarySort(event.target.value as LibrarySort)}
              value={librarySort}
            >
              {LIBRARY_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="room-scene">
        <section aria-label="CD library" className="shelf-cabinet" ref={shelfRef}>
          <div className="shelf-cabinet__top" />
          {rows.map((row, rowIndex) => (
            <div className="shelf-row" key={rowIndex}>
              <div className="shelf-row__back">
                <div className="shelf-row__contents">
                  {row.map((album) => {
                    const isOnTable = tableAlbumIdSet.has(album.id);
                    return (
                      <div
                        className={`cd-spine-wrap${isOnTable ? ' cd-spine-wrap--on-table' : ''}`}
                        key={album.id}
                        onKeyDown={isOnTable ? undefined : (event) => handleSpineKeyDown(event, album)}
                      >
                        {isOnTable
                          ? <ShelfPlaceholder album={album} />
                          : <CdSpine album={album} onOpen={() => setSelectedAlbum(album)} />}
                      </div>
                    );
                  })}
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

        <ListeningTable
          activeAlbumId={activePlayerAlbumId}
          albums={tableAlbums}
          onCleanUp={() => setTableAlbumIds([])}
          onOpenAlbum={setSelectedAlbum}
        />
      </div>

      <footer className="library-footer">
        <span>{albums.length} {albums.length === 1 ? 'album' : 'albums'}</span>
        <span>
          {tableAlbums.length > 0
            ? `${tableAlbums.length} on the listening table`
            : 'Stored locally in this browser'}
        </span>
      </footer>

      {albums.length > 0 && playbackReady && (
        <SpotifyPlayerDock
          hidden={!playerVisible}
          initialAlbum={playerAlbum}
          initialPlayback={savedPlayback}
          onClose={() => setPlayerVisible(false)}
          onPlayingAlbumChange={handlePlayingAlbumChange}
          ref={playerRef}
          shelfAlbums={albums}
        />
      )}

      {searchOpen && <SearchDialog libraryIds={libraryIds} onAdd={addAlbum} onClose={closeSearch} />}
      {selectedAlbum && (
        <AlbumDialog
          album={selectedAlbum}
          onClose={closeAlbum}
          onPlay={playSelectedAlbum}
          onRemove={removeSelectedAlbum}
          onReturnToShelf={tableAlbumIdSet.has(selectedAlbum.id) ? returnSelectedAlbumToShelf : undefined}
        />
      )}
      {pendingImport && (
        <ImportDialog
          albumCount={pendingImport.albums.length}
          currentAlbumCount={albums.length}
          fileName={pendingImport.fileName}
          onClose={() => setPendingImport(null)}
          onMerge={() => finishImport('merge')}
          onReplace={() => finishImport('replace')}
        />
      )}
    </main>
  );
}

export default CdLibrary;
