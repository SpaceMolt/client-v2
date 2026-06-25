import { spacemoltAuthLogin, createSession as createApiSession } from './generated';
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
  let authenticating = false;

  // Mint a fresh API session, then authenticate against it. The login endpoint
  // requires the X-Session-Id header of a freshly-minted session
  // (POST /api/v2/session); without it the server replies `session_required` and
  // returns no session id. We publish the minted id before logging in so the
  // request interceptor stamps it on the login call.
  async function authenticate(): Promise<void> {
    authenticating = true;
    try {
      const created = await createApiSession({ client });
      const minted = extractSessionId(created.data);
      if (!minted) {
        const code = (created.data as { error?: { code?: string } } | undefined)?.error?.code;
        throw new Error(`Session creation failed${code ? ` (${code})` : ''}: no session id returned`);
      }
      sessionId = minted;

      const res = await spacemoltAuthLogin({
        client,
        body: { username: opts.username, password: opts.password },
      });
      const code = (res.data as { error?: { code?: string } } | undefined)?.error?.code;
      if (code) {
        throw new Error(`Login failed (${code}): no session id returned`);
      }
      // Login may rotate the session id; otherwise keep the freshly minted one.
      sessionId = extractSessionId(res.data) ?? minted;
    } finally {
      authenticating = false;
    }
  }

  // Pristine request clones, captured before the body is consumed, keyed by the live request.
  const pendingClones = new WeakMap<Request, Request>();

  client.interceptors.request.use((request: Request) => {
    pendingClones.set(request, request.clone());
    if (sessionId) request.headers.set('X-Session-Id', sessionId);
    return request;
  });

  client.interceptors.response.use(async (response: Response, request: Request) => {
    const original = pendingClones.get(request);
    pendingClones.delete(request);

    // Don't re-enter authentication on the session-mint / login traffic it generates.
    if (authenticating) return response;

    let body: { error?: { code?: string } } | undefined;
    try {
      body = await response.clone().json();
    } catch {
      return response; // non-JSON; nothing to inspect
    }

    const code = body?.error?.code;
    if (code && AUTH_ERROR_CODES.has(code) && original) {
      await authenticate();
      const retry = original.clone();
      retry.headers.set('X-Session-Id', sessionId);
      // Bypass interceptors on the retry to avoid recursion.
      return fetch(retry);
    }

    return response;
  });

  await authenticate();

  return {
    client,
    get sessionId() {
      return sessionId;
    },
  };
}
