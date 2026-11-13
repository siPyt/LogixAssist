"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.BRIDGE_NAME = void 0;
exports.originMatches = originMatches;
exports.createBridge = createBridge;
const http = __importStar(require("node:http"));
const node_crypto_1 = require("node:crypto");
exports.BRIDGE_NAME = 'logix-assistant-bridge';
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_MESSAGES = 40;
const MAX_CHARS = 20000;
const MAX_CONTEXT_CHARS = 150000;
/** Exact match, or a pattern where `*` stands for one host label chunk, e.g. https://*.vercel.app */
function originMatches(origin, pattern) {
    if (!pattern.includes('*'))
        return origin === pattern;
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+');
    return new RegExp(`^${escaped}$`, 'i').test(origin);
}
function tokensEqual(a, b) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && (0, node_crypto_1.timingSafeEqual)(left, right);
}
function isMessage(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const m = value;
    return ((m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.length > 0 &&
        m.content.length <= MAX_CHARS);
}
class HttpError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new HttpError(413, 'Request too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}
function sendJson(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
}
function createBridge(options) {
    const { port, provider } = options;
    async function handle(req, res) {
        // Reject DNS-rebinding style requests: only our own loopback host names.
        const host = (req.headers.host ?? '').toLowerCase();
        if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
            return sendJson(res, 403, { error: 'Forbidden host' });
        }
        // Browsers always send Origin on cross-origin requests; only allow listed apps.
        const origin = req.headers.origin;
        if (origin !== undefined) {
            const allowed = options.getAllowedOrigins().some((p) => originMatches(origin, p));
            if (!allowed)
                return sendJson(res, 403, { error: 'Origin not allowed' });
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
            res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Private-Network', 'true');
            res.setHeader('Access-Control-Max-Age', '600');
        }
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            return res.end();
        }
        const path = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (path === '/health' && req.method === 'GET') {
            return sendJson(res, 200, { ok: true, name: exports.BRIDGE_NAME, features: ['context'] });
        }
        // One-click pairing for the app. Only browsers from an allowed origin get the
        // token (the Origin header can't be forged by a web page), so a random site can't.
        if (path === '/pair' && req.method === 'POST') {
            if (origin === undefined)
                return sendJson(res, 403, { error: 'Pairing requires a browser origin' });
            return sendJson(res, 200, { token: options.getToken() });
        }
        const auth = req.headers.authorization ?? '';
        const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        if (!supplied || !tokensEqual(supplied, options.getToken())) {
            return sendJson(res, 401, { error: 'Invalid or missing pairing token' });
        }
        if (path === '/models' && req.method === 'GET') {
            return sendJson(res, 200, await provider.listModels());
        }
        if (path === '/chat' && req.method === 'POST') {
            return handleChat(req, res);
        }
        return sendJson(res, 404, { error: 'Not found' });
    }
    async function handleChat(req, res) {
        let body;
        try {
            body = JSON.parse(await readBody(req));
        }
        catch (err) {
            if (err instanceof HttpError)
                throw err;
            throw new HttpError(400, 'Invalid JSON body');
        }
        const messages = body.messages;
        if (!Array.isArray(messages) ||
            messages.length === 0 ||
            messages.length > MAX_MESSAGES ||
            !messages.every(isMessage)) {
            throw new HttpError(400, 'Invalid messages');
        }
        const modelId = typeof body.model === 'string' && body.model.length <= 200 ? body.model : undefined;
        if (body.context !== undefined &&
            body.context !== null &&
            (typeof body.context !== 'string' || body.context.length > MAX_CONTEXT_CHARS)) {
            throw new HttpError(400, 'Invalid context');
        }
        const context = typeof body.context === 'string' && body.context ? body.context : undefined;
        res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-transform',
            'x-accel-buffering': 'no',
        });
        res.flushHeaders();
        const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
        const abort = new AbortController();
        res.on('close', () => {
            if (!res.writableEnded)
                abort.abort();
        });
        try {
            const result = await provider.chat(messages, { modelId, context, signal: abort.signal }, (delta) => send({ delta }));
            send({ done: true, model: result.model });
        }
        catch (err) {
            if (!abort.signal.aborted) {
                send({ error: err instanceof Error ? err.message : 'Model request failed' });
            }
        }
        finally {
            res.end();
        }
    }
    return http.createServer((req, res) => {
        handle(req, res).catch((err) => {
            const status = err instanceof HttpError ? err.status : 500;
            const message = err instanceof HttpError ? err.message : 'Internal error';
            if (!res.headersSent)
                sendJson(res, status, { error: message });
            else
                res.end();
        });
    });
}
