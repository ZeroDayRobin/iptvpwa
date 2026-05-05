# IPTVpwa

> **Fork notice — this is not the upstream IPTVnator.**
> IPTVpwa is a Progressive-Web-App-focused fork of [IPTVnator](https://github.com/4gray/iptvnator) by [4gray](https://github.com/4gray), distributed under the MIT License (see [LICENSE.md](./LICENSE.md)).
> The IPTVnator name and logo are trademarks of 4gray and are **not** used by this fork — see [TRADEMARK.md](./TRADEMARK.md).
> For the official IPTVnator project, releases, and community channels (Telegram, Bluesky, Ko-fi, GitHub Sponsors) please go to the [upstream repository](https://github.com/4gray/iptvnator).

---

## What is IPTVpwa?

IPTVpwa is a video player **Progressive Web App** for IPTV playlist playback (m3u, m3u8). It runs in any modern browser without installation, supports adding playlists by URL or local file, and stores everything client-side in IndexedDB. EPG (XMLTV) is supported via URL.

The fork's focus is the **web/PWA** target of the upstream codebase — packaged for self-hosting on Vercel and similar static hosts. The Electron desktop targets, native installers, MPV/VLC integration, and SQLite/Drizzle backend remain in the source tree (inherited from upstream) but are not the primary deliverable here.

> ⚠️ IPTVpwa does not provide any playlists or other digital content. You are responsible for the legality of the streams you load.

## Credit & Attribution

Practically all of the application code in this repository was written by **[4gray](https://github.com/4gray)** and the [IPTVnator contributors](https://github.com/4gray/iptvnator/graphs/contributors). This fork only changes branding strings and the deployment target — the player, parser, EPG, Xtream/Stalker portals, NgRx state, and UI all come from upstream.

If you find this useful, please consider supporting the upstream author:

- ☕ [Ko-fi: 4gray](https://ko-fi.com/4gray)
- 💖 [GitHub Sponsors: 4gray](https://github.com/sponsors/4gray)

## Features (inherited from upstream)

- M3U / M3U8 playlist support 📺
- Radio playlist support with dedicated audio player 📻
- Xtream Codes (XC) and Stalker portal (STB) support
- Add playlists from the file system or remote URLs 📂
- Automatic playlist updates on application startup
- Channel search 🔍
- EPG (TV Guide) with detailed information
- TV archive / catchup / timeshift
- Group-based channel list
- Favorite channels (per-playlist and global)
- Recently viewed channels
- HTML5 video player with HLS.js or Video.js
- Light and Dark themes
- Internationalization (16 languages)
- Custom User-Agent header per playlist

For screenshots and a full upstream feature list, see the [original README](https://github.com/4gray/iptvnator#readme).

## Available builds

| Surface | URL / artifact | Notes |
|---|---|---|
| **PWA (browser)** | https://iptvpwa.vercel.app | Mobile, desktop, smart-TV browsers. HTTP-only IPTV streams transit a Vercel `/stream` proxy (bandwidth-limited). |
| **Android APK** | [latest GitHub Release](https://github.com/ZeroDayRobin/iptvpwa/releases) | Capacitor wrapper, native Android shell. **HTTP streams play directly** (no proxy hop, no Vercel bandwidth). |

### Installing the Android APK

1. Download `iptvpwa-android-*.apk` from the [Releases page](https://github.com/ZeroDayRobin/iptvpwa/releases).
2. On your phone: enable "Install unknown apps" for your browser (Settings → Apps → your browser → Advanced → Install unknown apps).
3. Open the APK file → Install. The first install warns this is debug-signed — tap "Install anyway".
4. Launch IPTVpwa, add your Xtream/M3U/Stalker source the same way you would in the PWA.

The Android shell uses the same Angular bundle as the PWA — every fix and feature lands in both with one commit. The only behavioural difference is that the native shell skips the `/stream` proxy and connects to your IPTV provider directly, which removes the Vercel bandwidth cost and avoids datacenter-IP rate-limiting that some providers apply.

## Build & Deploy (PWA target)

Requirements: Node.js with pnpm via Corepack.

```bash
corepack enable
pnpm install
pnpm build:frontend:pwa     # → dist/apps/web
```

Local dev server:

```bash
pnpm serve:frontend:pwa     # http://localhost:4200
```

### Deploy to Vercel

- Framework Preset: **Other**
- Build Command: `corepack enable && pnpm install && pnpm build:frontend:pwa`
- Output Directory: `dist/apps/web`
- Node Version: 20.x or 22.x

The PWA is fully client-side (storage = IndexedDB), so no environment variables, secrets, or backend services are required.

## Build & Deploy (Android APK target)

The Android shell is a thin Capacitor wrapper around the same `dist/apps/web` Angular bundle the PWA ships. Configuration lives in [`capacitor.config.ts`](./capacitor.config.ts).

**CI build (recommended):** push a `v*-android` tag, GitHub Actions builds the debug APK and attaches it to a GitHub Release automatically. The workflow lives in [`.github/workflows/android-apk.yml`](./.github/workflows/android-apk.yml).

```bash
git tag v0.1.0-android
git push origin v0.1.0-android
# → APK appears under https://github.com/ZeroDayRobin/iptvpwa/releases
```

**Local build (requires Android Studio + JDK 21 + Android SDK 35):**

```bash
corepack enable
pnpm install
pnpm build:frontend:pwa     # build the web bundle Capacitor will package
npx cap add android         # one-time, generates the android/ folder
npx cap sync android        # copy bundle into android/app/src/main/assets/public
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

To switch to a release-signed APK suitable for the Play Store, generate a keystore, store its credentials as GitHub secrets, and replace `assembleDebug` with `assembleRelease` in the workflow. See the upstream Capacitor docs for details.

## Trademark & Naming

The name **"IPTVnator"** and its logo are unregistered trademarks of 4gray. They are intentionally **not** used by this fork. The MIT license covers the source code only — it does not grant rights to the upstream brand. See [TRADEMARK.md](./TRADEMARK.md) for the full upstream notice. If you re-fork this project, please pick your own name and icon as well.

## License

[MIT](./LICENSE.md). Copyright © 2020–2021 the original IPTVnator authors. Modifications in this fork are also released under the MIT License.

## Upstream Documentation

For Electron build instructions, troubleshooting (macOS quarantine, Linux chrome-sandbox, Wayland), package managers (Homebrew, Snap, AUR, Gentoo), the full screenshot gallery, and contributor list, please consult the [upstream README](https://github.com/4gray/iptvnator#readme).
