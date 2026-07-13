import type { AlbumDetail } from '@/lib/spotify-contracts';

export type {
  AlbumDetail,
  AlbumSummary,
  AlbumTrack,
  AuthStatus,
  SearchResponse,
} from '@/lib/spotify-contracts';

export type LibraryAlbum = AlbumDetail & {
  addedAt: string;
  spineColor: string;
};

export type StoredLibraryAlbum = Omit<LibraryAlbum, 'addedAt'> & {
  addedAt?: string;
};
