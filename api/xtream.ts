// Vercel serverless replacement for /xtream from 4gray/iptvnator-backend.
//
// Proxies a single Xtream Codes API request server-side. The PWA cannot make
// these requests directly because Xtream servers do not send CORS headers and
// many run on plain HTTP, which an HTTPS PWA cannot reach (mixed content).
//
// Response envelope shape — { payload, action } on success, { message, status }
// on failure — matches upstream so PwaService.forwardXtreamRequest stays
// unchanged. Note: upstream returns errors with HTTP 200 and the error info in
// the body; we preserve that quirk.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';

const XTREAM_API_PATH = '/player_api.php';

export default async function handler(
    req: VercelRequest,
    res: VercelResponse
) {
    res.setHeader('Access-Control-Allow-Origin', '*');

    const url = typeof req.query.url === 'string' ? req.query.url : undefined;
    if (!url) {
        return res.status(400).send('Missing url');
    }

    const action =
        typeof req.query.action === 'string' ? req.query.action : undefined;

    try {
        const result = await axios.get(url + XTREAM_API_PATH, {
            params: req.query,
            timeout: 25_000,
        });
        return res.status(200).json({ payload: result.data, action });
    } catch (error: unknown) {
        if (axios.isAxiosError(error)) {
            return res.status(200).json({
                message: error.response?.statusText ?? 'Error: not found',
                status: error.response?.status ?? 404,
            });
        }
        return res
            .status(200)
            .json({ message: 'Error: not found', status: 404 });
    }
}
