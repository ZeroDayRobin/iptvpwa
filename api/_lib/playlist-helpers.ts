// Shared helpers for the api/* Vercel Functions.
// Files/folders prefixed with "_" inside /api are not exposed as endpoints,
// so this module is import-only.
//
// Logic mirrors 4gray/iptvnator-backend/index.js so the response shape stays
// drop-in compatible with PwaService in apps/web — that way the PWA does not
// need any client-side changes when we move from the upstream parser-api to
// our same-origin Vercel Functions.

import type { ParsedPlaylist } from './types';

export function guid(): string {
    return Math.random().toString(36).slice(2);
}

export function getLastUrlSegment(value: string): string {
    if (value && value.length > 1) {
        return value.substring(value.lastIndexOf('/') + 1);
    }
    return 'Playlist without title';
}

export function createPlaylistObject(
    name: string,
    playlist: ParsedPlaylist,
    url: string
) {
    const now = new Date().toISOString();
    return {
        id: guid(),
        _id: guid(),
        filename: name,
        title: name,
        count: playlist.items.length,
        playlist: {
            ...playlist,
            items: playlist.items.map((item) => ({ id: guid(), ...item })),
        },
        importDate: now,
        lastUsage: now,
        favorites: [],
        autoRefresh: false,
        url,
    };
}
