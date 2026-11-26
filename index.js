/**
 * Host half of the OpenCode Go quota status pill.
 *
 * Registers one same-origin GET route (`/go-quota/usage`) that resolves the
 * OpenCode Go API key through the composition's credentials service (falling
 * back to the environment and to `$DSH_HOME/.credentials.yaml`), then relays
 * the upstream usage document. The browser half polls that route.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROUTE = '/go-quota/usage';
const UPSTREAM = 'https://opencode.ai/inference/go/v1/usage';
const API_KEY_REF = 'OPENCODE_GO_API_KEY';
const SESSION_HEADER = 'dsh-go-quota';
const CACHE_MS = 30_000;
const UPSTREAM_TIMEOUT_MS = 8_000;

export const inject = ['webServer'];

let cache;

function dshHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  return join(homedir(), '.dsh');
}

/** Crude read of one `refs:` entry: the stored file is a flat `key: value` block. */
function refFromFile(ref) {
  let text;
  try {
    text = readFileSync(join(dshHome(), '.credentials.yaml'), 'utf8');
  } catch {
    return undefined;
  }
  const entry = new RegExp(`^\\s{2,}${ref}\\s*:\\s*(.+)$`, 'm').exec(text);
  if (entry === null) return undefined;
  const value = entry[1].trim().replace(/^['"]|['"]$/g, '');
  return value.length > 0 ? value : undefined;
}

async function resolveApiKey(ctx) {
  const credentials = ctx.get('credentials');
  if (credentials !== undefined) {
    try {
      const hit = await credentials.resolve(API_KEY_REF);
      if (hit !== undefined && typeof hit.value === 'string' && hit.value.length > 0) return hit.value;
    } catch {
      // Fall through to the ambient sources below.
    }
  }
  const fromEnv = process.env[API_KEY_REF];
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  return refFromFile(API_KEY_REF);
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function readUsage(ctx) {
  const now = Date.now();
  if (cache !== undefined && now - cache.at < CACHE_MS) return cache.payload;

  const key = await resolveApiKey(ctx);
  if (key === undefined) {
    return { ok: false, message: `no credential named ${API_KEY_REF}` };
  }

  let response;
  try {
    response = await fetch(UPSTREAM, {
      headers: { authorization: `Bearer ${key}`, 'x-opencode-session': SESSION_HEADER },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, message: `upstream request failed: ${String(error?.message ?? error)}` };
  }

  const text = await response.text();
  if (!response.ok) {
    return { ok: false, message: `upstream HTTP ${String(response.status)}: ${text.slice(0, 300)}` };
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, message: 'upstream returned a non-JSON body' };
  }

  const payload = { ok: true, fetchedAt: new Date().toISOString(), usage: body?.usage ?? body };
  cache = { at: now, payload };
  return payload;
}

export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE,
        handler: async (req, res) => {
          const connection = ctx.get('connection');
          const rejection = connection?.requestRejection?.(req);
          if (rejection !== undefined) {
            res.statusCode = rejection;
            res.end();
            return;
          }
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.setHeader('allow', 'GET, HEAD');
            sendJson(res, 405, { ok: false, message: 'use GET' });
            return;
          }
          try {
            sendJson(res, 200, await readUsage(ctx));
          } catch (error) {
            sendJson(res, 500, { ok: false, message: String(error?.message ?? error) });
          }
        },
      }),
    `go-quota: GET ${ROUTE}`,
  );
}
