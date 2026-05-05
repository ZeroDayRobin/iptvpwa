// Vercel serverless stream proxy.
//
// HTTPS PWAs cannot load `http://` HLS playlists or progressive media because
// of the browser's Mixed Content rule. This proxy fetches the origin URL
// server-side and pipes it back to the player over the same HTTPS origin
// the PWA is served from, so the browser is happy.
//
// For HLS playlists (.m3u8), the body is rewritten so every segment, key,
// and sub-playlist URI also routes through this proxy — without that, the
// player would see relative segment paths resolved against the proxy URL
// and break, or absolute http:// segment URLs and re-trigger Mixed Content.
//
// For everything else (.ts segments, .mp4 VOD, encryption keys, init
// segments) the upstream response is stream-piped through with Range/
// Content-Range headers preserved so seek and adaptive-bitrate switching
// keep working.
//
// Bandwidth notice: every byte of streamed video flows through this
// function. On Vercel Hobby (100 GB/month) that's roughly 50 hours of
// 1080p before the deployment auto-disables. Use accordingly.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios, { type AxiosResponseHeaders } from 'axios';
import http from 'node:http';
import https from 'node:https';
import type { Readable } from 'node:stream';

const insecureHttpsAgent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true,
});
const httpAgent = new http.Agent({ keepAlive: true });

function isHlsPlaylist(url: string, contentType: string): boolean {
    const lc = (contentType || '').toLowerCase();
    if (lc.includes('mpegurl') || lc.includes('x-mpegurl')) return true;
    return /\.m3u8?(\?|$)/i.test(url);
}

function makeProxyUrl(req: VercelRequest, target: string): string {
    const host = req.headers.host || 'iptvpwa.vercel.app';
    const proto =
        (Array.isArray(req.headers['x-forwarded-proto'])
            ? req.headers['x-forwarded-proto'][0]
            : req.headers['x-forwarded-proto']) || 'https';
    return `${proto}://${host}/api/stream?url=${encodeURIComponent(target)}`;
}

function resolveUrl(base: string, ref: string): string {
    try {
        return new URL(ref, base).href;
    } catch {
        return ref;
    }
}

// Walk an HLS playlist line by line. Bare URL lines become absolute proxy
// URLs; tag lines with URI="..." attributes (EXT-X-KEY, EXT-X-MAP,
// EXT-X-MEDIA, EXT-X-I-FRAME-STREAM-INF, etc.) get their URI rewritten in
// place so non-segment dependencies route through the proxy too.
function rewriteHlsPlaylist(
    text: string,
    baseUrl: string,
    req: VercelRequest
): string {
    return text
        .split(/\r?\n/)
        .map((line) => {
            const trimmed = line.trim();

            if (trimmed && !trimmed.startsWith('#')) {
                return makeProxyUrl(req, resolveUrl(baseUrl, trimmed));
            }

            if (trimmed.startsWith('#') && trimmed.includes('URI=')) {
                return line.replace(/URI="([^"]+)"/g, (_match, uri) => {
                    return `URI="${makeProxyUrl(req, resolveUrl(baseUrl, String(uri)))}"`;
                });
            }

            return line;
        })
        .join('\n');
}

function pickHeader(
    headers: AxiosResponseHeaders | Record<string, unknown>,
    key: string
): string | undefined {
    const value = (headers as Record<string, unknown>)[key];
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    return undefined;
}

export default async function handler(
    req: VercelRequest,
    res: VercelResponse
): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'Range, Content-Type, Accept'
    );
    res.setHeader(
        'Access-Control-Expose-Headers',
        'Content-Length, Content-Range, Accept-Ranges'
    );

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    const rawUrl = req.query.url;
    const url = typeof rawUrl === 'string' ? rawUrl : undefined;
    if (!url) {
        res.status(400).send('Missing url');
        return;
    }

    if (!/^https?:\/\//i.test(url)) {
        res.status(400).send('Invalid url scheme — only http(s) allowed');
        return;
    }

    try {
        const isHttps = url.toLowerCase().startsWith('https://');

        const forwardHeaders: Record<string, string> = {};
        if (req.headers.range) {
            forwardHeaders['Range'] = String(req.headers.range);
        }
        // Many IPTV origins reject requests without a normal browser UA.
        forwardHeaders['User-Agent'] =
            (req.headers['user-agent'] as string | undefined) ??
            'Mozilla/5.0';

        const response = await axios.get<Readable>(url, {
            httpsAgent: isHttps ? insecureHttpsAgent : undefined,
            httpAgent: isHttps ? undefined : httpAgent,
            responseType: 'stream',
            timeout: 30_000,
            maxRedirects: 5,
            headers: forwardHeaders,
            validateStatus: () => true,
        });

        res.status(response.status);

        const contentType = pickHeader(response.headers, 'content-type') ?? '';

        if (isHlsPlaylist(url, contentType)) {
            const chunks: Buffer[] = [];
            for await (const chunk of response.data) {
                chunks.push(
                    typeof chunk === 'string'
                        ? Buffer.from(chunk)
                        : (chunk as Buffer)
                );
            }
            const text = Buffer.concat(chunks).toString('utf-8');
            const rewritten = rewriteHlsPlaylist(text, url, req);

            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Cache-Control', 'no-store');
            res.send(rewritten);
            return;
        }

        // Pipe non-playlist bytes (.ts segments, .mp4 VOD, AES keys, init
        // segments) back to the player as a stream so memory stays flat
        // even on long progressive responses.
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }
        const contentLength = pickHeader(response.headers, 'content-length');
        if (contentLength) res.setHeader('Content-Length', contentLength);
        const contentRange = pickHeader(response.headers, 'content-range');
        if (contentRange) res.setHeader('Content-Range', contentRange);
        const acceptRanges = pickHeader(response.headers, 'accept-ranges');
        if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);

        // Brief edge cache so retries within the same playback don't hammer
        // the origin a second time. HLS playlists themselves are no-store
        // (handled above) because they are dynamic.
        res.setHeader('Cache-Control', 'public, max-age=10');

        response.data.pipe(res);
    } catch (error: unknown) {
        const message = axios.isAxiosError(error)
            ? `Upstream stream error: ${error.message}`
            : 'Stream proxy error';
        if (!res.headersSent) {
            res.status(502).send(message);
        } else {
            res.end();
        }
    }
}
