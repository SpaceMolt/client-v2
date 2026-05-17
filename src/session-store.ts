import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync, unlinkSync, renameSync, copyFileSync, appendFileSync } from 'fs';
import { dirname, basename, join } from 'path';

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

/**
 * Handles reading, writing, migration, and caching of the session file.
 * All file I/O goes through this class.
 */
export class SessionStore {
  private cache: MultiSessionFile | null = null;
  private gitignoreChecked = false;
  readonly path: string;
  private readonly _debug: boolean | (() => boolean);

  private get debug(): boolean {
    return typeof this._debug === 'function' ? this._debug() : this._debug;
  }

  constructor(path: string, debug: boolean | (() => boolean)) {
    this.path = path;
    this._debug = debug;
  }

  /** Load store from disk (with caching). Returns cached copy on subsequent calls. */
  load(): MultiSessionFile {
    if (this.cache) return this.cache;

    if (!existsSync(this.path)) {
      this.cache = { version: 2, activeAccount: null, accounts: {} };
      return this.cache;
    }

    try {
      const raw = readFileSync(this.path, 'utf-8');
      const parsed = JSON.parse(raw);

      if (parsed.version === 2) {
        this.cache = parsed as MultiSessionFile;
      } else {
        // V1 format: plain SessionData object — migrate silently
        this.cache = this.migrateV1(parsed as SessionData);
        this.save();
      }
    } catch {
      // Corrupt file — back it up and start fresh
      const backupPath = this.path + '.corrupt';
      try { copyFileSync(this.path, backupPath); } catch { /* best effort */ }
      if (this.debug) {
        console.error(`[session] Corrupt session file backed up to ${backupPath}`);
      }
      this.cache = { version: 2, activeAccount: null, accounts: {} };
    }

    return this.cache;
  }

  /** Atomically write the store to disk. */
  save(): void {
    const dir = dirname(this.path);

    try {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Atomic write: write to temp file, then rename into place
      const tmpPath = this.path + '.tmp';
      writeFileSync(tmpPath, JSON.stringify(this.cache, null, 2));
      try {
        chmodSync(tmpPath, 0o600);
      } catch {
        // chmod may fail on some platforms (Windows)
      }
      renameSync(tmpPath, this.path);
    } catch (err) {
      throw new Error(`Session file write failed (${this.path}): ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!this.gitignoreChecked) {
      this.gitignoreChecked = true;
      this.ensureGitignored();
    }
  }

  /** Delete the session file and clear the cache. */
  destroy(): void {
    this.cache = null;
    try {
      unlinkSync(this.path);
    } catch {
      // File may not exist
    }
  }

  /** Reset the in-memory cache (forces reload on next load()). */
  invalidate(): void {
    this.cache = null;
  }

  /**
   * Walk up from the session file's directory to find a .git root,
   * then ensure the session filename is listed in .gitignore there.
   */
  private ensureGitignored(): void {
    try {
      const filename = basename(this.path);
      let current = dirname(this.path);

      while (true) {
        if (existsSync(join(current, '.git'))) {
          const gitignorePath = join(current, '.gitignore');
          if (existsSync(gitignorePath)) {
            const content = readFileSync(gitignorePath, 'utf-8');
            const lines = content.split('\n').map(l => l.trim());
            if (lines.some(l => l === filename || l === `/${filename}`)) {
              return; // already ignored
            }
            appendFileSync(gitignorePath, `\n${filename}\n`);
          } else {
            writeFileSync(gitignorePath, `${filename}\n`);
          }
          console.error(`Note: Added ${filename} to .gitignore`);
          return;
        }
        const parent = dirname(current);
        if (parent === current) break; // reached filesystem root
        current = parent;
      }
    } catch {
      // Best effort — don't fail session write if gitignore update fails
    }
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
}
