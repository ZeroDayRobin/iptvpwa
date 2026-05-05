// Vercel serverless replacement for /stalker from 4gray/iptvnator-backend.
//
// Proxies a single Stalker portal request server-side and forwards the MAC
// address as a Cookie (mac=...) — the protocol the portal expects. Optional
// bearer token is forwarded as Authorization.
//
// Response envelope shape — { payload, action } on success, { message, status }
// on failure — matches upstream so PwaService.forwardStalkerRequest stays
// unchanged.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';

export default async function handler(
    req: VercelRequest,
    res: VercelResponse
) {
    res.setHeader('Access-Control-Allow-Origin', '*');

    const url = typeof req.query.url === 'string' ? req.query.url : undefined;
    if (!url) {
        return res.status(400).send('Missing url');
    }

    const macAddress =
        typeof req.query.macAddress === 'string'
            ? req.query.macAddress
            : undefined;
    const token =
        typeof req.query.token === 'string' ? req.query.token : undefined;
    const action =
        typeof req.query.action === 'string' ? req.query.action : undefined;

    try {
        const result = await axios.get(url, {
            params: req.query,
            headers: {
                ...(macAddress ? { Cookie: `mac=${macAddress}` } : {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
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
