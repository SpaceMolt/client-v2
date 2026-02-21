import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync, unlinkSync, renameSync, copyFileSync } from 'fs';
import { dirname, join } from 'path';
import { SESSION_PATH, API_BASE, DEBUG } from './config.ts';

export interface SessionData {
  id: string;
  created_at: string;
  expires_at: string;
  username?: string;
  password?: string;
  player_id?: string;
}

export interface AccountData {
  username: string;
  password?: string;
  session: {
    id: string;
    created_at: string;
    expires_at: string;
    player_id?: string;
  } | null;
}

export interface MultiSessionFile {
  version: 2;
  activeAccount: string | null;
  accounts: Record<string, AccountData>;
  pendingSession?: SessionData;
}

export interface AccountInfo {
  username: string;
  isActive: boolean;
  hasValidSession: boolean;
  playerId?: string;
}

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
  debug: boolean;
}

export class SessionManager {
  private store: MultiSessionFile | null = null;
  private credentialWarningShown = false;
  private readonly sessionPath: string;
  private readonly apiBase: string;
  private readonly debug: boolean;

  constructor(opts: SessionManagerOptions) {
    this.sessionPath = opts.sessionPath;
    this.apiBase = opts.apiBase;
    this.debug = opts.debug;
  }

  private loadStore(): MultiSessionFile {
    if (this.store) return this.store;

    if (!existsSync(this.sessionPath)) {
      this.store = { version: 2, activeAccount: null, accounts: {} };
      return this.store;
    }

    try {
      const raw = readFileSync(this.sessionPath, 'utf-8');
      const parsed = JSON.parse(raw);

      if (parsed.version === 2) {
        this.store = parsed as MultiSessionFile;
      } else {
        // V1 format: plain SessionData object — migrate silently
        this.store = this.migrateV1(parsed as SessionData);
        this.saveStore();
      }
    } catch {
      // Corrupt file — back it up and start fresh
      const backupPath = this.sessionPath + '.corrupt';
      try { copyFileSync(this.sessionPath, backupPath); } catch { /* best effort */ }
      if (this.debug) {
        console.error(`[session] Corrupt session file backed up to ${backupPath}`);
      }
      this.store = { version: 2, activeAccount: null, accounts: {} };
    }

    return this.store;
  }

  private saveStore(): void {
    const dir = dirname(this.sessionPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Atomic write: write to temp file, then rename into place
    const tmpPath = this.sessionPath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(this.store, null, 2));
    try {
      chmodSync(tmpPath, 0o600);
    } catch {
      // chmod may fail on some platforms (Windows)
    }
    renameSync(tmpPath, this.sessionPath);
  }

  private migrateV1(old: SessionData): MultiSessionFile {
    const store: MultiSessionFile = { version: 2, activeAccount: null, accounts: {} };

    if (old.username) {
      const key = old.username.toLowerCase();
      store.activeAccount = key;
      store.accounts[key] = {
        username: old.username,
        password: old.password,
        session: {
          id: old.id,
          created_at: old.created_at,
          expires_at: old.expires_at,
          player_id: old.player_id,
        },
      };
    } else if (old.id) {
      // Anonymous session with no username — store as pending
      store.pendingSession = old;
    }

    return store;
  }

  private getActiveAccount(): AccountData | null {
    const store = this.loadStore();
    if (!store.activeAccount) return null;
    return store.accounts[store.activeAccount] || null;
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

  loadSession(): SessionData | null {
    const store = this.loadStore();

    // Try active account first
    const account = this.getActiveAccount();
    if (account?.session) {
      return this.accountSessionToSessionData(account);
    }

    // Fall back to pending session
    if (store.pendingSession) {
      return store.pendingSession;
    }

    return null;
  }

  saveSession(session: SessionData): void {
    const store = this.loadStore();

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
      store.pendingSession = session;
    }

    if ((session.username || session.password) && !this.credentialWarningShown) {
      this.credentialWarningShown = true;
      console.error(`Note: Credentials stored in plaintext at ${this.sessionPath}`);
    }

    this.saveStore();
  }

  async createSession(): Promise<SessionData> {
    if (this.debug) console.error('[session] Creating new session...');

    const response = await fetch(`${this.apiBase}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
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

    // Preserve stored credentials from active account or pending session
    const account = this.getActiveAccount();
    if (account) {
      session.username = account.username;
      session.password = account.password;
    } else {
      const store = this.loadStore();
      if (store.pendingSession?.username) session.username = store.pendingSession.username;
      if (store.pendingSession?.password) session.password = store.pendingSession.password;
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
        signal: AbortSignal.timeout(30_000),
      });

      const data = await response.json();
      if (data.error) {
        if (this.debug) console.error(`[session] Re-auth failed: ${data.error.message}`);
        return null;
      }

      if (data.session) {
        session.id = data.session.id || session.id;
        session.expires_at = data.session.expires_at || session.expires_at;
        session.player_id = data.session.player_id || session.player_id;
      }

      this.saveSession(session);
      return session;
    } catch (err) {
      if (this.debug) console.error(`[session] Re-auth error:`, err);
      return null;
    }
  }

  storeCredentials(username: string, password: string): void {
    const store = this.loadStore();
    const key = username.toLowerCase();

    // Get or create account entry
    let account = store.accounts[key];
    if (!account) {
      account = { username, password, session: null };
      store.accounts[key] = account;
    } else {
      account.username = username;
      account.password = password;
    }

    // Move pending session to this account if present
    if (store.pendingSession) {
      account.session = {
        id: store.pendingSession.id,
        created_at: store.pendingSession.created_at,
        expires_at: store.pendingSession.expires_at,
        player_id: store.pendingSession.player_id,
      };
      delete store.pendingSession;
    }

    // Set as active account
    store.activeAccount = key;

    if (!this.credentialWarningShown) {
      this.credentialWarningShown = true;
      console.error(`Note: Credentials stored in plaintext at ${this.sessionPath}`);
    }

    this.saveStore();
  }

  switchAccount(username: string): boolean {
    const store = this.loadStore();
    const key = username.toLowerCase();

    if (!store.accounts[key]) return false;

    store.activeAccount = key;
    this.saveStore();
    return true;
  }

  getAccounts(): AccountInfo[] {
    const store = this.loadStore();
    return Object.entries(store.accounts).map(([key, account]) => ({
      username: account.username,
      isActive: store.activeAccount === key,
      hasValidSession: account.session !== null && !this.isExpired(account.session.expires_at),
      playerId: account.session?.player_id,
    }));
  }

  getActiveUsername(): string | null {
    const store = this.loadStore();
    if (!store.activeAccount) return null;
    const account = store.accounts[store.activeAccount];
    return account?.username || null;
  }

  hasValidSession(username: string): boolean {
    const store = this.loadStore();
    const key = username.toLowerCase();
    const account = store.accounts[key];
    if (!account?.session) return false;
    return !this.isExpired(account.session.expires_at);
  }

  clearSession(): void {
    this.store = null;
    try {
      unlinkSync(this.sessionPath);
    } catch {
      // File may not exist
    }
  }
}

// Default instance using config values
const defaultManager = new SessionManager({
  sessionPath: SESSION_PATH,
  apiBase: API_BASE,
  debug: DEBUG,
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
