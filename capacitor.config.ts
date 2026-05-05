import type { CapacitorConfig } from '@capacitor/cli';

// IPTVpwa Android (and later iOS) wrapper config.
//
// The PWA already lives at iptvpwa.vercel.app, but the browser there can't
// reach `http://` IPTV streams (Mixed Content) and routes everything through
// our Vercel /stream proxy — bandwidth-expensive and IP-rate-limited by the
// origin. A native Capacitor shell loads the same Angular bundle from a
// `capacitor://localhost` origin where Mixed Content rules don't apply, so
// http streams play directly from the provider with no proxy hop.
//
// `wrapForProxyIfNeeded` (xtream-url.service.ts and m3u video-player) checks
// `window.Capacitor?.isNativePlatform?.()` at runtime and skips the proxy
// wrap when this shell is the runtime — Electron, Capacitor and HTTPS-target
// URLs all bypass the proxy by design.

const config: CapacitorConfig = {
    appId: 'app.iptvpwa.android',
    appName: 'IPTVpwa',
    webDir: 'dist/apps/web',
    bundledWebRuntime: false,
    server: {
        // Allow http(s) URLs that the player loads (HLS playlists, .ts
        // segments, .mp4 VOD files) — without this Android WebView still
        // applies the same Mixed Content default as a regular browser.
        androidScheme: 'https',
        // Useful for local dev: point at a running `pnpm serve:frontend:pwa`.
        // url: 'http://10.0.2.2:4200',
        // cleartext: true,
    },
    plugins: {
        SplashScreen: {
            launchShowDuration: 1500,
            backgroundColor: '#1b1c1c',
            androidSplashResourceName: 'splash',
            showSpinner: false,
        },
        StatusBar: {
            style: 'DARK',
            backgroundColor: '#1b1c1c',
        },
    },
    android: {
        // Disable Android WebView's Mixed Content blocking. With Capacitor's
        // capacitor://localhost origin treated as secure-context, http
        // resources would still trigger a Mixed Content warning unless this
        // flag is on. Required for IPTV streams from http-only providers.
        allowMixedContent: true,
        // Hardware acceleration for video — keeps HLS playback smooth.
        webContentsDebuggingEnabled: false,
        // Allow content under app's webview to be inspected via chrome://inspect
        // when set to true; flip on for troubleshooting builds, off for
        // public releases.
    },
};

export default config;
