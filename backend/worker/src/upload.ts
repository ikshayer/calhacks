import { createReadStream, createWriteStream, type ReadStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from './config.ts';

/**
 * Local upload server. The browser POSTs a raw video body to /upload, the file is
 * stored in config.uploadsDir, and the returned `upload:<file>` is saved as the
 * video's sourceUrl. GET /uploads/<file> serves it back (with Range) for playback.
 */

const MAX_BYTES = 200 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function sendJson(res: ServerResponse, status: number, body: object) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Resolves a requested file name inside uploadsDir, rejecting anything that could escape it. */
function uploadPath(name: string): string {
  if (!/^[\w.-]+$/.test(name) || name.startsWith('.')) throw new HttpError(400, `Invalid file name "${name}"`);
  const root = resolve(config.uploadsDir);
  const path = resolve(root, name);
  if (!path.startsWith(root + sep)) throw new HttpError(400, `Invalid file name "${name}"`);
  return path;
}

async function handleUpload(req: IncomingMessage, res: ServerResponse) {
  const header = req.headers['x-file-name'];
  if (typeof header !== 'string' || !header) throw new HttpError(400, 'Missing X-File-Name header');
  let originalName: string;
  try {
    originalName = decodeURIComponent(header);
  } catch {
    throw new HttpError(400, 'X-File-Name is not valid URI-encoded text');
  }
  const ext = extname(originalName).toLowerCase();
  if (!(ext in CONTENT_TYPES)) {
    throw new HttpError(400, `Unsupported file type "${ext}"; allowed: ${Object.keys(CONTENT_TYPES).join(', ')}`);
  }

  const declared = Number(req.headers['content-length']);
  if (declared > MAX_BYTES) throw new HttpError(413, `File is larger than ${MAX_BYTES / 1024 / 1024} MB`);

  await mkdir(config.uploadsDir, { recursive: true });
  const name = `${randomUUID()}${ext}`;
  const path = uploadPath(name);

  let received = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > MAX_BYTES) callback(new HttpError(413, `File is larger than ${MAX_BYTES / 1024 / 1024} MB`));
      else callback(null, chunk);
    },
  });

  try {
    await pipeline(req, limiter, createWriteStream(path));
  } catch (error) {
    await rm(path, { force: true });
    throw error;
  }
  if (received === 0) {
    await rm(path, { force: true });
    throw new HttpError(400, 'Empty upload');
  }

  console.log(`[upload] stored ${name} (${received} bytes) from "${originalName}"`);
  sendJson(res, 200, { source: `upload:${name}` });
}

/** Parses a single `bytes=start-end` range; returns null when the header is malformed. */
function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) return null;
  return { start, end };
}

async function handleDownload(req: IncomingMessage, res: ServerResponse, rawName: string) {
  let name: string;
  try {
    name = decodeURIComponent(rawName);
  } catch {
    throw new HttpError(400, 'Malformed file name');
  }
  const path = uploadPath(name);
  const contentType = CONTENT_TYPES[extname(name).toLowerCase()];
  if (!contentType) throw new HttpError(400, 'Unsupported file type');

  let size: number;
  try {
    size = (await stat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'Not found');
    throw error;
  }

  const rangeHeader = req.headers.range;
  const base = { 'Content-Type': contentType, 'Accept-Ranges': 'bytes' };
  let stream: ReadStream;
  if (rangeHeader) {
    const range = parseRange(rangeHeader, size);
    if (!range) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      ...base,
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      'Content-Length': range.end - range.start + 1,
    });
    stream = createReadStream(path, { start: range.start, end: range.end });
  } else {
    res.writeHead(200, { ...base, 'Content-Length': size });
    stream = createReadStream(path);
  }
  if (req.method === 'HEAD') {
    stream.destroy();
    res.end();
    return;
  }
  // Headers are already sent, so a mid-stream failure can only be logged and the connection closed.
  await pipeline(stream, res).catch((error: unknown) => {
    console.error('[upload] download interrupted:', error instanceof Error ? error.message : String(error));
  });
}

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/upload') return handleUpload(req, res);
  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/uploads/')) {
    return handleDownload(req, res, url.pathname.slice('/uploads/'.length));
  }
  throw new HttpError(404, 'Not found');
}

export function startUploadServer(): Server {
  const server = createServer((req, res) => {
    // Echo the caller's origin only when it is on the list; an unlisted site gets no CORS header.
    const origin = req.headers.origin;
    if (origin && config.uploadAllowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      // Chrome asks before a public https page may call 127.0.0.1 (Private Network Access).
      if (req.headers['access-control-request-private-network'] === 'true') {
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
      }
    }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-File-Name');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    route(req, res).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[upload] ${req.method} ${req.url} -> ${status}: ${message}`);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendJson(res, status, { error: status === 500 ? 'Internal error while handling the upload' : message });
      // An over-limit body is still streaming in; stop reading it.
      if (status === 413) req.destroy();
    });
  });
  server.on('error', (error) => {
    console.error('[upload] server error:', error.message);
    process.exit(1);
  });
  server.listen(config.uploadPort, '127.0.0.1', () => {
    console.log(`[upload] listening on http://127.0.0.1:${config.uploadPort} (CORS: ${config.uploadAllowedOrigins.join(', ')})`);
  });
  return server;
}
