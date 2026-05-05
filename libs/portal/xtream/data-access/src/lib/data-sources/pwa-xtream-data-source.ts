import { inject, Injectable } from '@angular/core';
import {
    PlaybackPositionData,
    XtreamPendingRestoreState,
    XtreamCategory,
    XtreamLiveStream,
    XtreamSerieItem,
    XtreamVodStream,
} from 'shared-interfaces';
import { createLogger } from '@iptvnator/portal/shared/util';
import {
    CategoryType,
    StreamType,
    XtreamApiService,
    XtreamCredentials,
} from '../services/xtream-api.service';
import {
    DbCategoryType,
    IXtreamDataSource,
    ProgressCallback,
    XtreamOperationOptions,
    XtreamCategoryFromDb,
    XtreamContentItem,
    XtreamPlaylistData,
} from './xtream-data-source.interface';

/**
 * LocalStorage keys for PWA persistence
 */
const STORAGE_KEYS = {
    FAVORITES: 'xtream-favorites',
    RECENT_ITEMS: 'xtream-recent-items',
    PLAYLISTS: 'xtream-playlists',
    PLAYBACK_POSITIONS: 'xtream-playback-positions',
    HIDDEN_CATEGORIES: 'xtream-hidden-categories',
};

const dbToCategoryType: Record<DbCategoryType, CategoryType> = {
    live: 'live',
    movies: 'vod',
    series: 'series',
};

interface CategoryShape {
    readonly category_id?: string | number;
    readonly category_name?: string;
}

interface XtreamCachedContentItem {
    readonly added?: string;
    readonly category_id?: string | number;
    readonly id?: number;
    readonly name?: string;
    readonly poster_url?: string;
    readonly series_id?: number;
    readonly stream_display_name?: string;
    readonly stream_id?: number;
    readonly stream_icon?: string;
    readonly title?: string;
    readonly type?: string;
    readonly viewed_at?: string;
}

interface StoredRecentItem {
    readonly id: number;
    readonly viewedAt: string;
}

/**
 * PWA implementation of the Xtream data source.
 * Uses API-only strategy: always fetch from API, no database caching.
 * Favorites and recently viewed are stored in localStorage.
 */
@Injectable({ providedIn: 'root' })
export class PwaXtreamDataSource implements IXtreamDataSource {
    private readonly apiService = inject(XtreamApiService);
    private readonly logger = createLogger('PwaXtreamDataSource');

    // In-memory cache for the current session
    private categoryCache = new Map<string, XtreamCategory[]>();
    private contentCache = new Map<string, XtreamCachedContentItem[]>();

    // updateCategoryVisibility() in IXtreamDataSource doesn't carry a
    // playlistId — Electron uses globally unique DB primary keys, PWA has
    // none. Track the playlist whose categories were last surfaced via
    // getAllCategories() so the subsequent visibility write knows which
    // localStorage bucket to update.
    private lastQueriedPlaylistForVisibility: string | null = null;

    // =========================================================================
    // Playlist Operations (localStorage)
    // =========================================================================

    async getPlaylist(playlistId: string): Promise<XtreamPlaylistData | null> {
        const playlists = this.getPlaylistsFromStorage();
        return playlists.find((p) => p.id === playlistId) || null;
    }

    async createPlaylist(playlist: XtreamPlaylistData): Promise<void> {
        const playlists = this.getPlaylistsFromStorage();
        playlists.push(playlist);
        this.savePlaylistsToStorage(playlists);
    }

    async updatePlaylist(
        playlistId: string,
        updates: Partial<XtreamPlaylistData>
    ): Promise<void> {
        const playlists = this.getPlaylistsFromStorage();
        const index = playlists.findIndex((p) => p.id === playlistId);
        if (index !== -1) {
            playlists[index] = { ...playlists[index], ...updates };
            this.savePlaylistsToStorage(playlists);
        }
    }

    async deletePlaylist(playlistId: string): Promise<void> {
        const playlists = this.getPlaylistsFromStorage();
        const filtered = playlists.filter((p) => p.id !== playlistId);
        this.savePlaylistsToStorage(filtered);

        // Also clear favorites and recent items for this playlist
        this.clearFavoritesForPlaylist(playlistId);
        this.clearRecentItemsForPlaylist(playlistId);
        this.clearPlaybackPositionsForPlaylist(playlistId);

        // Clear cache
        this.clearCacheForPlaylist(playlistId);
    }

    private getPlaylistsFromStorage(): XtreamPlaylistData[] {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.PLAYLISTS);
            return data ? JSON.parse(data) : [];
        } catch {
            return [];
        }
    }

    private savePlaylistsToStorage(playlists: XtreamPlaylistData[]): void {
        localStorage.setItem(STORAGE_KEYS.PLAYLISTS, JSON.stringify(playlists));
    }

    // =========================================================================
    // Category Operations (API + in-memory cache)
    // =========================================================================

    async hasCategories(
        playlistId: string,
        type: DbCategoryType
    ): Promise<boolean> {
        const cacheKey = `${playlistId}-${type}-categories`;
        return this.categoryCache.has(cacheKey);
    }

    async getCategories(
        playlistId: string,
        credentials: XtreamCredentials,
        type: CategoryType,
        options?: XtreamOperationOptions
    ): Promise<XtreamCategory[]> {
        void options;
        const cacheKey = `${playlistId}-${type}-categories`;

        // Check in-memory cache first
        let cachedCategories = this.categoryCache.get(cacheKey);
        if (!cachedCategories) {
            cachedCategories = await this.apiService.getCategories(
                credentials,
                type
            );
            this.categoryCache.set(cacheKey, cachedCategories);
        }

        // Apply user-managed visibility (Manage Categories dialog). The cache
        // keeps the unfiltered upstream response so toggling visibility back
        // on does not require another API call.
        const hiddenIds = this.getHiddenCategoryIdSet(playlistId);
        if (hiddenIds.size === 0) {
            return cachedCategories;
        }
        return cachedCategories.filter(
            (cat) => !hiddenIds.has(this.toXtreamId(cat as CategoryShape))
        );
    }

    async getAllCategories(
        playlistId: string,
        type: DbCategoryType
    ): Promise<XtreamCategoryFromDb[]> {
        // Track the playlist for the subsequent updateCategoryVisibility call.
        // Manage Categories is modal, so the next visibility write is always
        // for this playlist.
        this.lastQueriedPlaylistForVisibility = playlistId;

        const apiType = dbToCategoryType[type];
        const cacheKey = `${playlistId}-${apiType}-categories`;
        const cached = this.categoryCache.get(cacheKey) ?? [];
        const hiddenIds = this.getHiddenCategoryIdSet(playlistId);

        return cached.map((cat): XtreamCategoryFromDb => {
            const xtreamId = this.toXtreamId(cat as CategoryShape);
            const name =
                ((cat as CategoryShape).category_name ?? '') ||
                `Category ${xtreamId}`;
            return {
                // PWA has no separate DB primary key, so use xtream_id as the
                // surrogate id. The dialog round-trips this id back into
                // updateCategoryVisibility() unchanged, so any stable value
                // works as long as it's per-category unique within a playlist.
                id: xtreamId,
                name,
                playlist_id: playlistId,
                type,
                xtream_id: xtreamId,
                hidden: hiddenIds.has(xtreamId),
            };
        });
    }

    async getCachedCategories(
        playlistId: string,
        type: CategoryType
    ): Promise<XtreamCategoryFromDb[]> {
        void playlistId;
        void type;
        return [];
    }

    async saveCategories(
        playlistId: string,
        categories: XtreamCategory[],
        type: DbCategoryType
    ): Promise<void> {
        // In PWA mode, we just cache in memory
        const cacheKey = `${playlistId}-${type}-categories`;
        this.categoryCache.set(cacheKey, categories);
    }

    async updateCategoryVisibility(
        categoryIds: number[],
        hidden: boolean
    ): Promise<void> {
        const playlistId = this.lastQueriedPlaylistForVisibility;
        if (!playlistId) {
            this.logger.warn(
                'updateCategoryVisibility called before getAllCategories — no playlist context, skipping'
            );
            return;
        }

        const all = this.getHiddenCategoriesFromStorage();
        const current = new Set(all[playlistId] ?? []);
        const ids = categoryIds.map((id) => Number(id)).filter((id) =>
            Number.isFinite(id)
        );

        if (hidden) {
            for (const id of ids) {
                current.add(id);
            }
        } else {
            for (const id of ids) {
                current.delete(id);
            }
        }

        if (current.size === 0) {
            delete all[playlistId];
        } else {
            all[playlistId] = Array.from(current).sort((a, b) => a - b);
        }
        this.saveHiddenCategoriesToStorage(all);
    }

    // =========================================================================
    // Hidden categories (localStorage)
    // =========================================================================

    private getHiddenCategoryIdSet(playlistId: string): Set<number> {
        return new Set(this.getHiddenCategoriesFromStorage()[playlistId] ?? []);
    }

    private getHiddenCategoriesFromStorage(): Record<string, number[]> {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.HIDDEN_CATEGORIES);
            return data ? JSON.parse(data) : {};
        } catch {
            return {};
        }
    }

    private saveHiddenCategoriesToStorage(
        hidden: Record<string, number[]>
    ): void {
        localStorage.setItem(
            STORAGE_KEYS.HIDDEN_CATEGORIES,
            JSON.stringify(hidden)
        );
    }

    private toXtreamId(cat: CategoryShape): number {
        const raw = cat.category_id;
        if (typeof raw === 'number') return raw;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    // =========================================================================
    // Content/Stream Operations (API + in-memory cache)
    // =========================================================================

    async hasContent(
        playlistId: string,
        type: 'live' | 'movie' | 'series'
    ): Promise<boolean> {
        const cacheKey = `${playlistId}-${type}-content`;
        return this.contentCache.has(cacheKey);
    }

    async getContent(
        playlistId: string,
        credentials: XtreamCredentials,
        type: StreamType,
        onProgress?: (count: number) => void,
        onTotal?: (total: number) => void,
        options?: XtreamOperationOptions
    ): Promise<XtreamLiveStream[] | XtreamVodStream[] | XtreamSerieItem[]> {
        void options;
        const cacheKey = `${playlistId}-${type}-content`;

        // Check in-memory cache first
        const cachedContent = this.contentCache.get(cacheKey);
        if (cachedContent) {
            return cachedContent as
                | XtreamLiveStream[]
                | XtreamVodStream[]
                | XtreamSerieItem[];
        }

        // Fetch from API
        const apiContent = await this.apiService.getStreams(credentials, type);

        // The Electron data source returns DB-row-shaped items where the
        // identifier lives on `xtream_id`. PWA reads the raw API response
        // where it's `stream_id` (live/movie) or `series_id` (series).
        // Downstream code (xtream-url.service constructLiveUrl/constructVodUrl/
        // constructEpisodeUrl, favorites lookups, recently-viewed mapping)
        // reads `xtream_id` and silently builds `.../undefined.m3u8` URLs
        // without this normalisation.
        const content = (
            apiContent as unknown as Array<Record<string, unknown> & {
                xtream_id?: number;
                stream_id?: number;
                series_id?: number;
                id?: number;
            }>
        ).map((item) => ({
            ...item,
            xtream_id:
                item.xtream_id ??
                item.stream_id ??
                item.series_id ??
                item.id,
        })) as unknown as
            | XtreamLiveStream[]
            | XtreamVodStream[]
            | XtreamSerieItem[];

        // Report total and progress (PWA doesn't have incremental save, so report all at once)
        if (onTotal) {
            onTotal(content.length);
        }
        if (onProgress) {
            onProgress(content.length);
        }

        // Cache in memory
        this.contentCache.set(cacheKey, content);

        return content;
    }

    async getCachedContent(
        playlistId: string,
        type: StreamType
    ): Promise<XtreamContentItem[]> {
        void playlistId;
        void type;
        return [];
    }

    async saveContent(
        playlistId: string,
        streams:
            | XtreamLiveStream[]
            | XtreamVodStream[]
            | XtreamSerieItem[]
            | XtreamContentItem[],
        type: 'live' | 'movie' | 'series',
        onProgress?: ProgressCallback,
        options?: XtreamOperationOptions
    ): Promise<number> {
        void options;
        // In PWA mode, we just cache in memory
        const cacheKey = `${playlistId}-${type}-content`;
        this.contentCache.set(cacheKey, streams);

        if (onProgress) {
            onProgress(streams.length);
        }

        return streams.length;
    }

    // =========================================================================
    // Search Operations (in-memory filter)
    // =========================================================================

    async searchContent(
        playlistId: string,
        searchTerm: string,
        types: string[],
        excludeHidden?: boolean
    ): Promise<XtreamContentItem[]> {
        void excludeHidden;
        const results: XtreamCachedContentItem[] = [];
        const searchLower = searchTerm.toLowerCase();

        for (const type of types) {
            const cacheKey = `${playlistId}-${type}-content`;
            const content = this.contentCache.get(cacheKey) || [];

            const filtered = content.filter((item) => {
                const title =
                    item.name || item.title || item.stream_display_name || '';
                return title.toLowerCase().includes(searchLower);
            });

            results.push(...filtered);
        }

        return results as XtreamContentItem[];
    }

    // =========================================================================
    // Favorites Operations (localStorage)
    // =========================================================================

    async getFavorites(playlistId: string): Promise<XtreamContentItem[]> {
        const allFavorites = this.getFavoritesFromStorage();
        const playlistFavorites = allFavorites[playlistId] || [];

        // Match favorites with cached content
        const results: XtreamCachedContentItem[] = [];
        for (const type of ['live', 'movie', 'series']) {
            const cacheKey = `${playlistId}-${type}-content`;
            const content = this.contentCache.get(cacheKey) || [];

            for (const item of content) {
                const itemId = item.stream_id || item.series_id || item.id;
                if (playlistFavorites.includes(itemId)) {
                    results.push(item);
                }
            }
        }

        return results as XtreamContentItem[];
    }

    async addFavorite(
        contentId: number,
        playlistId: string,
        // PWA uses localStorage with no content table, so backdrop persistence
        // is electron-only. Accept the param for interface parity.
        _backdropUrl?: string
    ): Promise<void> {
        const allFavorites = this.getFavoritesFromStorage();
        if (!allFavorites[playlistId]) {
            allFavorites[playlistId] = [];
        }
        if (!allFavorites[playlistId].includes(contentId)) {
            allFavorites[playlistId].push(contentId);
        }
        this.saveFavoritesToStorage(allFavorites);
    }

    async removeFavorite(contentId: number, playlistId: string): Promise<void> {
        const allFavorites = this.getFavoritesFromStorage();
        if (allFavorites[playlistId]) {
            allFavorites[playlistId] = allFavorites[playlistId].filter(
                (id: number) => id !== contentId
            );
        }
        this.saveFavoritesToStorage(allFavorites);
    }

    async isFavorite(contentId: number, playlistId: string): Promise<boolean> {
        const allFavorites = this.getFavoritesFromStorage();
        return (allFavorites[playlistId] || []).includes(contentId);
    }

    private getFavoritesFromStorage(): Record<string, number[]> {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.FAVORITES);
            return data ? JSON.parse(data) : {};
        } catch {
            return {};
        }
    }

    private saveFavoritesToStorage(favorites: Record<string, number[]>): void {
        localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(favorites));
    }

    private clearFavoritesForPlaylist(playlistId: string): void {
        const allFavorites = this.getFavoritesFromStorage();
        delete allFavorites[playlistId];
        this.saveFavoritesToStorage(allFavorites);
    }

    // =========================================================================
    // Playback Position Operations (localStorage)
    // =========================================================================

    async savePlaybackPosition(
        playlistId: string,
        data: PlaybackPositionData
    ): Promise<void> {
        const allPositions = this.getPlaybackPositionsFromStorage();
        if (!allPositions[playlistId]) {
            allPositions[playlistId] = [];
        }

        // Remove existing entry if present
        allPositions[playlistId] = allPositions[playlistId].filter(
            (p) =>
                !(
                    p.contentXtreamId === data.contentXtreamId &&
                    p.contentType === data.contentType
                )
        );

        // Add new entry
        allPositions[playlistId].push({
            ...data,
            updatedAt: new Date().toISOString(),
        });

        this.savePlaybackPositionsToStorage(allPositions);
    }

    async getPlaybackPosition(
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ): Promise<PlaybackPositionData | null> {
        const allPositions = this.getPlaybackPositionsFromStorage();
        const playlistPositions = allPositions[playlistId] || [];

        return (
            playlistPositions.find(
                (p) =>
                    p.contentXtreamId === contentXtreamId &&
                    p.contentType === contentType
            ) || null
        );
    }

    async getSeriesPlaybackPositions(
        playlistId: string,
        seriesXtreamId: number
    ): Promise<PlaybackPositionData[]> {
        const allPositions = this.getPlaybackPositionsFromStorage();
        const playlistPositions = allPositions[playlistId] || [];

        return playlistPositions.filter(
            (p) =>
                p.contentType === 'episode' &&
                p.seriesXtreamId === seriesXtreamId
        );
    }

    async getRecentPlaybackPositions(
        playlistId: string,
        limit?: number
    ): Promise<PlaybackPositionData[]> {
        const allPositions = this.getPlaybackPositionsFromStorage();
        const playlistPositions = allPositions[playlistId] || [];

        // Sort by updatedAt descending
        playlistPositions.sort(
            (a, b) =>
                new Date(b.updatedAt).getTime() -
                new Date(a.updatedAt).getTime()
        );

        return limit ? playlistPositions.slice(0, limit) : playlistPositions;
    }

    async getAllPlaybackPositions(
        playlistId: string
    ): Promise<PlaybackPositionData[]> {
        const allPositions = this.getPlaybackPositionsFromStorage();
        return allPositions[playlistId] || [];
    }

    async clearPlaybackPosition(
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ): Promise<void> {
        const allPositions = this.getPlaybackPositionsFromStorage();
        if (allPositions[playlistId]) {
            allPositions[playlistId] = allPositions[playlistId].filter(
                (p) =>
                    !(
                        p.contentXtreamId === contentXtreamId &&
                        p.contentType === contentType
                    )
            );
            this.savePlaybackPositionsToStorage(allPositions);
        }
    }

    private getPlaybackPositionsFromStorage(): Record<
        string,
        PlaybackPositionData[]
    > {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.PLAYBACK_POSITIONS);
            return data ? JSON.parse(data) : {};
        } catch {
            return {};
        }
    }

    private savePlaybackPositionsToStorage(
        positions: Record<string, PlaybackPositionData[]>
    ): void {
        localStorage.setItem(
            STORAGE_KEYS.PLAYBACK_POSITIONS,
            JSON.stringify(positions)
        );
    }

    private clearPlaybackPositionsForPlaylist(playlistId: string): void {
        const allPositions = this.getPlaybackPositionsFromStorage();
        delete allPositions[playlistId];
        this.savePlaybackPositionsToStorage(allPositions);
    }

    // =========================================================================
    // Recently Viewed Operations (localStorage)
    // =========================================================================

    async getRecentItems(playlistId: string): Promise<XtreamContentItem[]> {
        const allRecent = this.getRecentItemsFromStorage();
        const playlistRecent = allRecent[playlistId] || [];

        // Match recent items with cached content
        const results: (XtreamCachedContentItem & { viewed_at: string })[] = [];
        for (const type of ['live', 'movie', 'series']) {
            const cacheKey = `${playlistId}-${type}-content`;
            const content = this.contentCache.get(cacheKey) || [];

            for (const item of content) {
                const itemId = item.stream_id || item.series_id || item.id;
                const recentEntry = playlistRecent.find((r) => r.id === itemId);
                if (recentEntry) {
                    results.push({
                        ...item,
                        viewed_at: recentEntry.viewedAt,
                    });
                }
            }
        }

        // Sort by viewed_at descending
        results.sort(
            (a, b) =>
                new Date(b.viewed_at).getTime() -
                new Date(a.viewed_at).getTime()
        );

        return results as XtreamContentItem[];
    }

    async addRecentItem(
        contentId: number,
        playlistId: string,
        _backdropUrl?: string
    ): Promise<void> {
        const allRecent = this.getRecentItemsFromStorage();
        if (!allRecent[playlistId]) {
            allRecent[playlistId] = [];
        }

        // Remove existing entry if present
        allRecent[playlistId] = allRecent[playlistId].filter(
            (r) => r.id !== contentId
        );

        // Add new entry at the beginning
        allRecent[playlistId].unshift({
            id: contentId,
            viewedAt: new Date().toISOString(),
        });

        // Keep only last 50 items
        allRecent[playlistId] = allRecent[playlistId].slice(0, 50);

        this.saveRecentItemsToStorage(allRecent);
    }

    async removeRecentItem(
        contentId: number,
        playlistId: string
    ): Promise<void> {
        const allRecent = this.getRecentItemsFromStorage();
        if (allRecent[playlistId]) {
            allRecent[playlistId] = allRecent[playlistId].filter(
                (r) => r.id !== contentId
            );
        }
        this.saveRecentItemsToStorage(allRecent);
    }

    async clearRecentItems(playlistId: string): Promise<void> {
        this.clearRecentItemsForPlaylist(playlistId);
    }

    private getRecentItemsFromStorage(): Record<string, StoredRecentItem[]> {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.RECENT_ITEMS);
            return data ? JSON.parse(data) : {};
        } catch {
            return {};
        }
    }

    private saveRecentItemsToStorage(
        recentItems: Record<string, StoredRecentItem[]>
    ): void {
        localStorage.setItem(
            STORAGE_KEYS.RECENT_ITEMS,
            JSON.stringify(recentItems)
        );
    }

    private clearRecentItemsForPlaylist(playlistId: string): void {
        const allRecent = this.getRecentItemsFromStorage();
        delete allRecent[playlistId];
        this.saveRecentItemsToStorage(allRecent);
    }

    // =========================================================================
    // Content Lookup
    // =========================================================================

    async getContentByXtreamId(
        xtreamId: number,
        playlistId: string,
        contentType?: 'live' | 'movie' | 'series'
    ): Promise<XtreamContentItem | null> {
        const types = contentType
            ? [contentType]
            : (['live', 'movie', 'series'] as const);

        for (const type of types) {
            const cacheKey = `${playlistId}-${type}-content`;
            const content = this.contentCache.get(cacheKey) || [];

            const found = content.find((item) => {
                const itemXtreamId =
                    item.stream_id || item.series_id || item.id;
                return itemXtreamId === xtreamId;
            });

            if (found) {
                return found as XtreamContentItem;
            }
        }

        return null;
    }

    private findContentIdentity(
        playlistId: string,
        xtreamId: number,
        contentType?: 'live' | 'movie' | 'series'
    ): { contentType: 'live' | 'movie' | 'series'; xtreamId: number } | null {
        const types = contentType
            ? [contentType]
            : (['live', 'movie', 'series'] as const);

        for (const type of types) {
            const cacheKey = `${playlistId}-${type}-content`;
            const content = this.contentCache.get(cacheKey) || [];

            const found = content.find((item) => {
                const itemXtreamId =
                    item.stream_id || item.series_id || item.id;
                return itemXtreamId === xtreamId;
            });

            if (found) {
                return {
                    contentType: type,
                    xtreamId,
                };
            }
        }

        return null;
    }

    // =========================================================================
    // Cleanup Operations
    // =========================================================================

    async clearPlaylistContent(
        playlistId: string
    ): Promise<XtreamPendingRestoreState> {
        // Get current favorites and recent items
        const favorites = this.getFavoritesFromStorage();
        const recentItems = this.getRecentItemsFromStorage();
        const playbackPositions =
            await this.getAllPlaybackPositions(playlistId);

        const typedFavorites = (favorites[playlistId] || [])
            .map((xtreamId) => this.findContentIdentity(playlistId, xtreamId))
            .filter(
                (
                    value
                ): value is {
                    contentType: 'live' | 'movie' | 'series';
                    xtreamId: number;
                } => value !== null
            );

        const typedRecentlyViewed = (recentItems[playlistId] || [])
            .map((item) => {
                const identity = this.findContentIdentity(playlistId, item.id);

                if (!identity) {
                    return null;
                }

                return {
                    ...identity,
                    viewedAt: item.viewedAt,
                };
            })
            .filter(
                (
                    value
                ): value is {
                    contentType: 'live' | 'movie' | 'series';
                    xtreamId: number;
                    viewedAt: string;
                } => value !== null
            );

        // Clear in-memory cache
        this.clearCacheForPlaylist(playlistId);

        return {
            hiddenCategories: [],
            favorites: typedFavorites,
            recentlyViewed: typedRecentlyViewed,
            playbackPositions,
        };
    }

    async restoreUserData(
        playlistId: string,
        restoreState: XtreamPendingRestoreState,
        options?: XtreamOperationOptions
    ): Promise<void> {
        void options;
        // Restore favorites
        const favorites = this.getFavoritesFromStorage();
        favorites[playlistId] = restoreState.favorites.map(
            (item) => item.xtreamId
        );
        this.saveFavoritesToStorage(favorites);

        // Restore recent items
        const recentItems = this.getRecentItemsFromStorage();
        recentItems[playlistId] = restoreState.recentlyViewed.map((item) => ({
            id: item.xtreamId,
            viewedAt: item.viewedAt,
        }));
        this.saveRecentItemsToStorage(recentItems);

        // Restore playback positions
        this.clearPlaybackPositionsForPlaylist(playlistId);
        const playbackPositions = this.getPlaybackPositionsFromStorage();
        playbackPositions[playlistId] = restoreState.playbackPositions.map(
            (position) => ({
                ...position,
                updatedAt: position.updatedAt ?? new Date().toISOString(),
            })
        );
        this.savePlaybackPositionsToStorage(playbackPositions);
    }

    // =========================================================================
    // Cache Management
    // =========================================================================

    /**
     * Clear in-memory cache entries for a specific playlist.
     * Called by the store when switching playlists to prevent stale data bleed.
     */
    clearSessionCache(playlistId: string): void {
        this.clearCacheForPlaylist(playlistId);
    }

    private clearCacheForPlaylist(playlistId: string): void {
        const keysToDelete: string[] = [];

        this.categoryCache.forEach((_, key) => {
            if (key.startsWith(playlistId)) {
                keysToDelete.push(key);
            }
        });
        keysToDelete.forEach((key) => this.categoryCache.delete(key));

        const contentKeysToDelete: string[] = [];
        this.contentCache.forEach((_, key) => {
            if (key.startsWith(playlistId)) {
                contentKeysToDelete.push(key);
            }
        });
        contentKeysToDelete.forEach((key) => this.contentCache.delete(key));
    }

    /**
     * Clear all in-memory caches
     */
    clearAllCaches(): void {
        this.categoryCache.clear();
        this.contentCache.clear();
    }
}
