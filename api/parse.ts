// Vercel serverless replacement for /parse from 4gray/iptvnator-backend.
//
// Fetches an M3U/M3U8 playlist URL server-side (bypassing browser CORS and
// mixed-content restrictions), parses it with `iptv-playlist-parser`, and
// returns the same playlist envelope shape PwaService expects.
//
// Self-signed TLS certs are accepted because many IPTV providers serve
// playlists from misconfigured HTTPS endpoints — matches upstream behavior.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import https from 'node:https';
import { parse } from 'iptv-playlist-parser';
import {
    createPlaylistObject,
    getLastUrlSegment,
} from './_lib/playlist-helpers';

const insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });

export default async function handler(
    req: VercelRequest,
    res: VercelResponse
) {
    res.setHeader('Access-Control-Allow-Origin', '*');

    const url = typeof req.query.url === 'string' ? req.query.url : undefined;
    if (!url) {
        return res.status(400).send('Missing url');
    }

    try {
        const response = await axios.get<string>(url, {
            httpsAgent: insecureHttpsAgent,
            responseType: 'text',
            transformResponse: [(data) => data],
            timeout: 25_000,
        });

        const parsed = parse(response.data);
        const title = getLastUrlSegment(url);
        const playlistObject = createPlaylistObject(title, parsed, url);
        return res.status(200).json(playlistObject);
    } catch (error: unknown) {
        if (axios.isAxiosError(error) && error.response) {
            return res
                .status(error.response.status)
                .send(error.response.statusText);
        }
        return res
            .status(500)
            .json({ status: 500, message: 'Error, something went wrong' });
    }
}
