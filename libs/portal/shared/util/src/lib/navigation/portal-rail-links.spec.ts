import { buildPortalRailLinks } from './portal-rail-links';

describe('buildPortalRailLinks', () => {
    it('builds Xtream links with scoped tooltip labels on Electron', () => {
        const links = buildPortalRailLinks({
            provider: 'xtreams',
            playlistId: 'xtream-1',
            isElectron: true,
            workspace: false,
        });

        expect(links.primary.map((link) => link.section)).toEqual([
            'vod',
            'live',
            'series',
        ]);
        expect(links.secondary.map((link) => link.section)).toEqual([
            'recently-added',
            'search',
            'downloads',
        ]);

        expect(links.primary[0]?.tooltip).toBe('Movies (this playlist)');
        expect(links.secondary[2]?.tooltip).toBe('Downloads (this playlist)');
    });

    it('builds workspace Xtream links without downloads on web', () => {
        const links = buildPortalRailLinks({
            provider: 'xtreams',
            playlistId: 'xtream-web',
            isElectron: false,
            workspace: true,
        });

        // Web/PWA used to be gimped to a single "library" tile — that hid
        // /live and /series even though both routes work. Now PWA gets the
        // same per-type rail Electron has, minus the Electron-only Downloads
        // tile in secondary.
        expect(links.primary.map((link) => link.section)).toEqual([
            'vod',
            'live',
            'series',
        ]);
        expect(links.secondary.map((link) => link.section)).toEqual([
            'recently-added',
            'search',
        ]);
        expect(links.primary[1]?.tooltip).toBe('Live TV (this playlist)');
        expect(links.primary[1]?.path).toEqual([
            '/workspace',
            'xtreams',
            'xtream-web',
            'live',
        ]);
    });

    it('builds Stalker links with scoped tooltip labels', () => {
        const links = buildPortalRailLinks({
            provider: 'stalker',
            playlistId: 'portal-1',
            isElectron: false,
            workspace: false,
        });

        expect(links.primary.map((link) => link.section)).toEqual([
            'vod',
            'itv',
            'series',
        ]);
        expect(links.secondary.map((link) => link.section)).toEqual(['search']);

        expect(links.primary[1]?.tooltip).toBe('Live TV (this playlist)');
        expect(links.secondary[0]?.tooltip).toBe('Search (this playlist)');
    });

    it('builds M3U playlist links with scoped tooltip labels', () => {
        const links = buildPortalRailLinks({
            provider: 'playlists',
            playlistId: 'm3u-1',
            isElectron: true,
            workspace: true,
        });

        expect(links.primary).toEqual([
            {
                icon: 'tv',
                tooltip: 'All channels (this playlist)',
                path: ['/workspace', 'playlists', 'm3u-1', 'all'],
                exact: true,
                section: 'all',
            },
            {
                icon: 'folder',
                tooltip: 'Groups (this playlist)',
                path: ['/workspace', 'playlists', 'm3u-1', 'groups'],
                exact: true,
                section: 'groups',
            },
        ]);
        expect(links.secondary).toEqual([]);
    });
});
