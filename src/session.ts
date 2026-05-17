import { SESSION_PATH, API_BASE, DEBUG } from './config.ts';
import { SessionStore } from './session-store.ts';

// Re-export types from session-store so consumers don't need to change imports
export type { SessionData, AccountData, MultiSessionFile, AccountInfo } from './session-store.ts';
import type { SessionData, AccountData, AccountInfo } from './session-store.ts';

/** Public interface for session management, used by ApiClient */
export interface SessionAdapter {
  loadSession(): SessionData | null;
  saveSession(session: SessionData): void;
  createSession(): Promise<SessionData>;
  getValidSession(): Promise<SessionData>;
  reAuthenticate(session: SessionData): Promise<SessionData | null>;
  storeCredentials(username: string, password: string): void;
  clearSession(): void;
}

export interface SessionManagerOptions {
  sessionPath: string;
  apiBase: string;
  debug: boolean | (() => boolean);
}

export class SessionManager {
  private readonly store: SessionStore;
  private credentialWarningShown = false;
  private readonly apiBase: string;
  private readonly _debug: boolean | (() => boolean);

  private get debug(): boolean {
    return typeof this._debug === 'function' ? this._debug() : this._debug;
  }

  constructor(opts: SessionManagerOptions) {
    this.store = new SessionStore(opts.sessionPath, opts.debug);
    this.apiBase = opts.apiBase;
    this._debug = opts.debug;
  }

  private getActiveAccount(): AccountData | null {
    const data = this.store.load();
    if (!data.activeAccount) return null;
    return data.accounts[data.activeAccount] || null;
  }

  private accountSessionToSessionData(account: AccountData): SessionData {
    const sess = account.session!;
    return {
      id: sess.id,
      created_at: sess.created_at,
      expires_at: sess.expires_at,
      player_id: sess.player_id,
      username: account.username,
      password: account.password,
    };
  }

  private isExpired(expiresAt: string): boolean {
    const expiresMs = new Date(expiresAt).getTime();
    const bufferMs = 60_000; // 1 minute buffer
    return Date.now() > expiresMs - bufferMs;
  }

  private showCredentialWarning(): void {
    if (!this.credentialWarningShown) {
      this.credentialWarningShown = true;
      console.error(`Note: Credentials stored in plaintext at ${this.store.path}`);
    }
  }

  // --- Session lifecycle ---

  loadSession(): SessionData | null {
    const data = this.store.load();

    // Try active account first
    const account = this.getActiveAccount();
    if (account?.session) {
      return this.accountSessionToSessionData(account);
    }

    // Fall back to pending session
    if (data.pendingSession) {
      return data.pendingSession;
    }

    return null;
  }

  saveSession(session: SessionData): void {
    const data = this.store.load();

    const account = this.getActiveAccount();
    if (account) {
      // Update active account's session
      account.session = {
        id: session.id,
        created_at: session.created_at,
        expires_at: session.expires_at,
        player_id: session.player_id,
      };
      if (session.username) account.username = session.username;
      if (session.password) account.password = session.password;
    } else {
      // No active account — store as pending
      data.pendingSession = session;
    }

    this.store.save();
  }

  async createSession(): Promise<SessionData> {
    if (this.debug) console.error('[session] Creating new session...');

    const response = await fetch(`${this.apiBase}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(300_000),
    });

    if (!response.ok) {
      throw new Error(`Failed to create session: HTTP ${response.status}`);
    }

    const result = await response.json();
    if (result.error) {
      throw new Error(`Failed to create session: ${result.error.message || result.error.code}`);
    }

    const session: SessionData = {
      id: result.session.id,
      created_at: result.session.created_at,
      expires_at: result.session.expires_at,
      player_id: result.session.player_id,
    };

    // Preserve stored credentials from active account or pending session
    const account = this.getActiveAccount();
    if (account) {
      session.username = account.username;
      session.password = account.password;
    } else {
      const data = this.store.load();
      if (data.pendingSession?.username) session.username = data.pendingSession.username;
      if (data.pendingSession?.password) session.password = data.pendingSession.password;
    }

    this.saveSession(session);
    return session;
  }

  async getValidSession(): Promise<SessionData> {
    let session = this.loadSession();

    if (!session || this.isExpired(session.expires_at)) {
      session = await this.createSession();
    }

    return session;
  }

  async reAuthenticate(session: SessionData): Promise<SessionData | null> {
    if (!session.username || !session.password) return null;

    if (this.debug) console.error(`[session] Re-authenticating as ${session.username}...`);

    try {
      const response = await fetch(`${this.apiBase}/spacemolt_auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': session.id,
        },
        body: JSON.stringify({
          username: session.username,
          password: session.password,
        }),
        signal: AbortSignal.timeout(300_000),
      });

      const result = await response.json();
      if (result.error) {
        if (this.debug) console.error(`[session] Re-auth failed: ${result.error.message}`);
        return null;
      }

      if (result.session) {
        session.id = result.session.id || session.id;
        session.expires_at = result.session.expires_at || session.expires_at;
        session.player_id = result.session.player_id || session.player_id;
      }

      this.saveSession(session);
      return session;
    } catch (err) {
      if (this.debug) console.error(`[session] Re-auth error:`, err);
      return null;
    }
  }

  // --- Account management ---

  storeCredentials(username: string, password: string): void {
    const data = this.store.load();
    const key = username.toLowerCase();

    // Get or create account entry
    let account = data.accounts[key];
    const isNew = !account;
    if (!account) {
      account = { username, password, session: null };
      data.accounts[key] = account;
    } else {
      account.username = username;
      account.password = password;
    }

    // Move pending session to this account if present
    if (data.pendingSession) {
      account.session = {
        id: data.pendingSession.id,
        created_at: data.pendingSession.created_at,
        expires_at: data.pendingSession.expires_at,
        player_id: data.pendingSession.player_id,
      };
      delete data.pendingSession;
    }

    // Set as active account
    data.activeAccount = key;

    this.store.save();
    // Only warn when storing credentials for the first time — not on every re-login
    if (isNew) {
      this.showCredentialWarning();
    }
  }

  switchAccount(username: string): boolean {
    const data = this.store.load();
    const key = username.toLowerCase();

    if (!data.accounts[key]) return false;

    data.activeAccount = key;
    this.store.save();
    return true;
  }

  getAccounts(): AccountInfo[] {
    const data = this.store.load();
    return Object.entries(data.accounts).map(([key, account]) => ({
      username: account.username,
      isActive: data.activeAccount === key,
      hasValidSession: account.session !== null && !this.isExpired(account.session.expires_at),
      playerId: account.session?.player_id,
    }));
  }

  getActiveUsername(): string | null {
    const data = this.store.load();
    if (!data.activeAccount) return null;
    const account = data.accounts[data.activeAccount];
    return account?.username || null;
  }

  hasValidSession(username: string): boolean {
    const data = this.store.load();
    const key = username.toLowerCase();
    const account = data.accounts[key];
    if (!account?.session) return false;
    return !this.isExpired(account.session.expires_at);
  }

  clearSession(): void {
    this.store.destroy();
  }
}

/**
 * Create a SessionAdapter that uses a fixed token and performs no file I/O.
 * Used when --session <token> is passed on the command line.
 */
export function createPassthroughAdapter(token: string): SessionAdapter {
  const staticSession: SessionData = {
    id: token,
    created_at: '',
    expires_at: '2099-12-31T23:59:59Z',
  };

  return {
    loadSession: () => ({ ...staticSession }),
    saveSession: () => {},
    createSession: async () => ({ ...staticSession }),
    getValidSession: async () => ({ ...staticSession }),
    reAuthenticate: async () => null,
    storeCredentials: () => {},
    clearSession: () => {},
  };
}

// Default instance using config values
const defaultManager = new SessionManager({
  sessionPath: SESSION_PATH,
  apiBase: API_BASE,
  debug: () => DEBUG,
});

// Module-level exports delegate to the default instance for backwards compatibility
export const loadSession = () => defaultManager.loadSession();
export const saveSession = (s: SessionData) => defaultManager.saveSession(s);
export const createSession = () => defaultManager.createSession();
export const getValidSession = () => defaultManager.getValidSession();
export const reAuthenticate = (s: SessionData) => defaultManager.reAuthenticate(s);
export const storeCredentials = (u: string, p: string) => defaultManager.storeCredentials(u, p);
export const clearSession = () => defaultManager.clearSession();
export const switchAccount = (u: string) => defaultManager.switchAccount(u);
export const getAccounts = () => defaultManager.getAccounts();
export const getActiveUsername = () => defaultManager.getActiveUsername();
export const hasValidSession = (u: string) => defaultManager.hasValidSession(u);
