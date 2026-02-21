import { API_BASE, DEBUG } from './config.ts';
import { type SessionAdapter, type SessionData, loadSession as _load, saveSession as _save, createSession as _create, getValidSession as _getValid, reAuthenticate as _reAuth, storeCredentials as _storeCreds, clearSession as _clear } from './session.ts';
import type { V2Response } from './generated/types.gen.ts';

const MAX_RETRIES = 3;

export interface ApiClientOptions {
  apiBase: string;
  debug: boolean;
  session: SessionAdapter;
}

export class ApiClient {
  private readonly apiBase: string;
  private readonly debug: boolean;
  private readonly session: SessionAdapter;

  constructor(opts: ApiClientOptions) {
    this.apiBase = opts.apiBase;
    this.debug = opts.debug;
    this.session = opts.session;
  }

  async call(
    path: string,
    body?: Record<string, unknown>,
    retryCount = 0,
  ): Promise<V2Response> {
    const session = await this.session.getValidSession();
    const url = `${this.apiBase}${path}`;

    if (this.debug) {
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
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new Error(`Connection failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (this.debug) {
      console.error(`[api] ${response.status} in ${Date.now() - start}ms`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      throw new Error(`Unexpected response type: ${contentType} (HTTP ${response.status})`);
    }

    let data: V2Response;
    try {
      data = (await response.json()) as V2Response;
    } catch {
      throw new Error(`Invalid JSON response from server (HTTP ${response.status})`);
    }

    // Update session from response
    if (data.session) {
      if (data.session.expires_at) session.expires_at = data.session.expires_at;
      if (data.session.player_id) session.player_id = data.session.player_id;
      if (data.session.id && data.session.id !== session.id) session.id = data.session.id;
      this.session.saveSession(session);
    }

    // Handle session expiry — create new session and re-auth
    if (data.error?.code === 'session_invalid' || data.error?.code === 'session_expired') {
      if (retryCount >= MAX_RETRIES) return data;

      if (this.debug) console.error('[api] Session expired, refreshing...');
      try {
        const newSession = await this.session.createSession();
        const reauthed = await this.session.reAuthenticate(newSession);
        if (reauthed) {
          return this.call(path, body, retryCount + 1);
        }
      } catch (err) {
        if (this.debug) console.error('[api] Re-auth retry failed:', err);
      }
      return data;
    }

    // Handle rate limiting
    if (data.error?.code === 'rate_limited') {
      if (retryCount >= MAX_RETRIES) return data;

      const waitSeconds = (data.error as Record<string, unknown>).wait_seconds;
      const waitMs = typeof waitSeconds === 'number' ? waitSeconds * 1000 : 10_000;
      const { c } = await import('./output/colors.ts');
      console.error(`${c.yellow}Rate limited, waiting ${(waitMs / 1000).toFixed(1)}s...${c.reset}`);
      await Bun.sleep(waitMs);
      return this.call(path, body, retryCount + 1);
    }

    // Store credentials on successful login/register
    if (!data.error) {
      if (path.endsWith('/login') || path.endsWith('/register')) {
        const username = body?.username as string | undefined;
        const password = (data.structuredContent?.password as string) || (body?.password as string);
        if (username && password) {
          this.session.storeCredentials(username, password);
        }
      }
    }

    return data;
  }

  async get(path: string): Promise<V2Response> {
    const session = await this.session.getValidSession();
    const url = `${this.apiBase}${path}`;

    if (this.debug) {
      console.error(`[api] GET ${url} session=${session.id.slice(0, 8)}...`);
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Session-Id': session.id,
      },
      signal: AbortSignal.timeout(30_000),
    });

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      const text = await response.text();
      return { result: text } as V2Response;
    }

    try {
      return (await response.json()) as V2Response;
    } catch {
      throw new Error(`Invalid JSON response from server (HTTP ${response.status})`);
    }
  }
}

// Default instance using config values + default session manager
// Adapter: wrap module-level functions as a SessionAdapter-like object
const defaultSessionAdapter: SessionAdapter = {
  loadSession: _load,
  saveSession: _save,
  createSession: _create,
  getValidSession: _getValid,
  reAuthenticate: _reAuth,
  storeCredentials: _storeCreds,
  clearSession: _clear,
};

const defaultClient = new ApiClient({
  apiBase: API_BASE,
  debug: DEBUG,
  session: defaultSessionAdapter,
});

// Module-level exports for backwards compatibility
export const apiCall = (path: string, body?: Record<string, unknown>, retryCount?: number) =>
  defaultClient.call(path, body, retryCount);
export const apiGet = (path: string) => defaultClient.get(path);
