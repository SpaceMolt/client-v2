import { spacemoltAuthLogin } from './generated';
import { createClient } from './generated/client';

/** Default API origin. Generated request URLs already include the /api/v2 prefix. */
export const DEFAULT_BASE_URL = 'https://game.spacemolt.com';

/** Error codes that mean "log in again and retry". Mirrors src/api.ts. */
const AUTH_ERROR_CODES = new Set(['session_invalid', 'session_expired', 'not_authenticated']);

export interface SessionOptions {
  username: string;
  password: string;
  /** Override the API origin (e.g. for self-hosted or test servers). */
  baseUrl?: string;
}

export interface SpacemoltSession {
  /** A configured client to pass to any generated SDK function as `{ client }`. */
  client: ReturnType<typeof createClient>;
  /** The current session id (updates after a re-auth). */
  readonly sessionId: string;
}

function extractSessionId(data: unknown): string | undefined {
  const d = data as
    | { session?: { id?: string }; session_id?: string; structuredContent?: { session_id?: string } }
    | undefined;
  return d?.session?.id ?? d?.session_id ?? d?.structuredContent?.session_id;
}

/**
 * Create an authenticated client: logs in, injects X-Session-Id on every request,
 * and transparently re-authenticates + retries once on an auth-expiry error.
 * Runtime-agnostic: no file system, no CLI logging.
 */
export async function createSession(opts: SessionOptions): Promise<SpacemoltSession> {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const client = createClient({ baseUrl });

  let sessionId = '';

  async function login(): Promise<string> {
    const res = await spacemoltAuthLogin({
      client,
      body: { username: opts.username, password: opts.password },
    });
    const id = extractSessionId(res.data);
    if (!id) {
      const code = (res.data as { error?: { code?: string } } | undefined)?.error?.code;
      throw new Error(`Login failed${code ? ` (${code})` : ''}: no session id returned`);
    }
    return id;
  }

  sessionId = await login();

  // Pristine request clones, captured before the body is consumed, keyed by the live request.
  const pendingClones = new WeakMap<Request, Request>();

  client.interceptors.request.use((request: Request) => {
    request.headers.set('X-Session-Id', sessionId);
    pendingClones.set(request, request.clone());
    return request;
  });

  client.interceptors.response.use(async (response: Response, request: Request) => {
    const original = pendingClones.get(request);
    pendingClones.delete(request);

    let body: { error?: { code?: string } } | undefined;
    try {
      body = await response.clone().json();
    } catch {
      return response; // non-JSON; nothing to inspect
    }

    const code = body?.error?.code;
    if (code && AUTH_ERROR_CODES.has(code) && original) {
      sessionId = await login();
      const retry = original.clone();
      retry.headers.set('X-Session-Id', sessionId);
      // Bypass interceptors on the retry to avoid recursion.
      return fetch(retry);
    }

    return response;
  });

  return {
    client,
    get sessionId() {
      return sessionId;
    },
  };
}
