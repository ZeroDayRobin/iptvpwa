// Minimal ambient typings for `iptv-playlist-parser`.
// The package is installed from a github tarball
// (see package.json: "iptv-playlist-parser": "github:4gray/iptv-playlist-parser")
// and ships no .d.ts files, so we declare the shapes we touch ourselves.
//
// Keep this in sync with what api/_lib/playlist-helpers.ts and api/parse.ts
// actually read off the parser result — do not over-spec.

export interface ParsedPlaylistItem {
    name?: string;
    tvg?: Record<string, unknown>;
    group?: { title?: string };
    http?: Record<string, unknown>;
    url?: string;
    raw?: string;
    [key: string]: unknown;
}

export interface ParsedPlaylist {
    header?: Record<string, unknown>;
    items: ParsedPlaylistItem[];
}

declare module 'iptv-playlist-parser' {
    export function parse(content: string): ParsedPlaylist;
}
