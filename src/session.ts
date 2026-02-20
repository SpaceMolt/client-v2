import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import { SESSION_PATH, API_BASE, DEBUG } from './config.ts';

export interface SessionData {
  id: string;
  created_at: string;
  expires_at: string;
  username?: string;
  password?: string;
  player_id?: string;
}

let cachedSession: SessionData | null = null;
let credentialWarningShown = false;

export function loadSession(): SessionData | null {
  if (cachedSession) return cachedSession;

  try {
    const data = readFileSync(SESSION_PATH, 'utf-8');
    cachedSession = JSON.parse(data) as SessionData;
    return cachedSession;
  } catch {
    return null;
  }
}

export function saveSession(session: SessionData): void {
  const dir = dirname(SESSION_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2));

  try {
    chmodSync(SESSION_PATH, 0o600);
  } catch {
    // chmod may fail on some platforms (Windows)
  }

  // Warn once when credentials are first stored
  if ((session.username || session.password) && !credentialWarningShown) {
    credentialWarningShown = true;
    if (DEBUG) {
      console.error(`[session] Credentials stored in ${SESSION_PATH}`);
    }
  }

  cachedSession = session;
}

export async function createSession(): Promise<SessionData> {
  if (DEBUG) console.error('[session] Creating new session...');

  const response = await fetch(`${API_BASE}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to create session: HTTP ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`Failed to create session: ${data.error.message || data.error.code}`);
  }

  const session: SessionData = {
    id: data.session.id,
    created_at: data.session.created_at,
    expires_at: data.session.expires_at,
    player_id: data.session.player_id,
  };

  // Preserve stored credentials from old session
  const old = loadSession();
  if (old?.username) session.username = old.username;
  if (old?.password) session.password = old.password;

  saveSession(session);
  return session;
}

function isExpired(session: SessionData): boolean {
  const expiresAt = new Date(session.expires_at).getTime();
  const bufferMs = 60_000; // 1 minute buffer
  return Date.now() > expiresAt - bufferMs;
}

export async function getValidSession(): Promise<SessionData> {
  let session = loadSession();

  if (!session || isExpired(session)) {
    session = await createSession();
  }

  return session;
}

export async function reAuthenticate(session: SessionData): Promise<SessionData | null> {
  if (!session.username || !session.password) return null;

  if (DEBUG) console.error(`[session] Re-authenticating as ${session.username}...`);

  try {
    const response = await fetch(`${API_BASE}/spacemolt_auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': session.id,
      },
      body: JSON.stringify({
        username: session.username,
        password: session.password,
      }),
    });

    const data = await response.json();
    if (data.error) {
      if (DEBUG) console.error(`[session] Re-auth failed: ${data.error.message}`);
      return null;
    }

    if (data.session) {
      session.id = data.session.id || session.id;
      session.expires_at = data.session.expires_at || session.expires_at;
      session.player_id = data.session.player_id || session.player_id;
    }

    saveSession(session);
    return session;
  } catch (err) {
    if (DEBUG) console.error(`[session] Re-auth error:`, err);
    return null;
  }
}

/** Store credentials after a successful login or register */
export function storeCredentials(username: string, password: string): void {
  const session = loadSession();
  if (session) {
    session.username = username;
    session.password = password;
    saveSession(session);
  }
}

/** Clear cached session (used on logout) */
export function clearSession(): void {
  cachedSession = null;
  try {
    unlinkSync(SESSION_PATH);
  } catch {
    // File may not exist
  }
}
