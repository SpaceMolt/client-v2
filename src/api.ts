import { API_BASE, DEBUG } from './config.ts';
import { getValidSession, createSession, reAuthenticate, saveSession, storeCredentials } from './session.ts';
import type { V2Response } from './generated/types.gen.ts';

const MAX_RETRIES = 3;

export async function apiCall(
  path: string,
  body?: Record<string, unknown>,
  retryCount = 0,
): Promise<V2Response> {
  const session = await getValidSession();
  const url = `${API_BASE}${path}`;

  if (DEBUG) {
    const redacted = body ? { ...body } : undefined;
    if (redacted?.password) redacted.password = '***';
    console.error(`[api] POST ${url} session=${session.id.slice(0, 8)}... body=${JSON.stringify(redacted)}`);
  }

  const start = Date.now();
  let response: Response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': session.id,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(`Connection failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (DEBUG) {
    console.error(`[api] ${response.status} in ${Date.now() - start}ms`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('json')) {
    throw new Error(`Unexpected response type: ${contentType} (HTTP ${response.status})`);
  }

  const data = (await response.json()) as V2Response;

  // Update session from response
  if (data.session) {
    if (data.session.expires_at) session.expires_at = data.session.expires_at;
    if (data.session.player_id) session.player_id = data.session.player_id;
    if (data.session.id && data.session.id !== session.id) session.id = data.session.id;
    saveSession(session);
  }

  // Handle session expiry — create new session and re-auth
  if (data.error?.code === 'session_invalid' || data.error?.code === 'session_expired') {
    if (retryCount >= MAX_RETRIES) return data;

    if (DEBUG) console.error('[api] Session expired, refreshing...');
    const newSession = await createSession();
    const reauthed = await reAuthenticate(newSession);
    if (reauthed) {
      return apiCall(path, body, retryCount + 1);
    }
    return data;
  }

  // Handle rate limiting
  if (data.error?.code === 'rate_limited') {
    if (retryCount >= MAX_RETRIES) return data;

    const waitSeconds = (data.error as Record<string, unknown>).wait_seconds;
    const waitMs = typeof waitSeconds === 'number' ? waitSeconds * 1000 : 10_000;
    console.error(`\x1b[33mRate limited, waiting ${(waitMs / 1000).toFixed(1)}s...\x1b[0m`);
    await Bun.sleep(waitMs);
    return apiCall(path, body, retryCount + 1);
  }

  // Store credentials on successful login/register
  if (!data.error) {
    if (path.endsWith('/login') || path.endsWith('/register')) {
      const username = body?.username as string | undefined;
      const password = (data.structuredContent?.password as string) || (body?.password as string);
      if (username && password) {
        storeCredentials(username, password);
      }
    }
  }

  return data;
}

/** GET request (for help endpoints and notifications) */
export async function apiGet(path: string): Promise<V2Response> {
  const session = await getValidSession();
  const url = `${API_BASE}${path}`;

  if (DEBUG) {
    console.error(`[api] GET ${url} session=${session.id.slice(0, 8)}...`);
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Session-Id': session.id,
    },
  });

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('json')) {
    // Help endpoints might return plain text
    const text = await response.text();
    return { result: text } as V2Response;
  }

  return (await response.json()) as V2Response;
}
