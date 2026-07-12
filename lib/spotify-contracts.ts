export type AlbumSummary = {
  id: string;
  name: string;
  artists: string[];
  imageUrl: string;
  spotifyUrl: string;
  releaseDate: string;
  totalTracks: number;
};

export type AlbumTrack = {
  id: string;
  name: string;
  durationMs: number;
  trackNumber: number;
  discNumber: number;
  spotifyUrl: string;
};

export type AlbumDetail = AlbumSummary & {
  tracks: AlbumTrack[];
  label?: string;
  copyrights?: string[];
};

export type AuthStatus = {
  authenticated: boolean;
  playbackReady: boolean;
};

export type SearchResponse = {
  albums: AlbumSummary[];
};
