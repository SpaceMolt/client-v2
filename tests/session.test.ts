import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { readFileSync, existsSync, mkdirSync, rmSync, writeFileSync, chmodSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SessionManager, type MultiSessionFile } from '../src/session.ts';
import { SessionStore } from '../src/session-store.ts';

const TEST_DIR = join(tmpdir(), `spacemolt-sess-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

function makeManager(subdir: string) {
  const dir = join(TEST_DIR, subdir);
  mkdirSync(dir, { recursive: true });
  return {
    manager: new SessionManager({ sessionPath: join(dir, 'session.json'), apiBase: 'http://test:9999/api/v2', debug: false }),
    path: join(dir, 'session.json'),
  };
}

/** Read and parse the multi-session file from disk */
function readStore(path: string): MultiSessionFile {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

afterEach(() => {
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
});

describe('SessionManager - file operations', () => {
  test('saveSession creates file with correct content (pending session)', () => {
    const { manager, path } = makeManager('save');

    manager.saveSession({
      id: 'test-id',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-12-31T23:59:59Z',
    });

    expect(existsSync(path)).toBe(true);
    const store = readStore(path);
    expect(store.version).toBe(2);
    // No active account, so stored as pending
    expect(store.pendingSession?.id).toBe('test-id');
  });

  test('saveSession updates active account session', () => {
    const { manager, path } = makeManager('save-active');

    // First store credentials to create an active account
    manager.saveSession({
      id: 'initial',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-12-31T23:59:59Z',
    });
    manager.storeCredentials('TestUser', 'TestPass');

    // Now saveSession should update the active account
    manager.saveSession({
      id: 'updated-id',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2027-12-31T23:59:59Z',
    });

    const store = readStore(path);
    expect(store.accounts['testuser'].session?.id).toBe('updated-id');
  });

  test('loadSession returns cached data after saveSession', () => {
    const { manager } = makeManager('cache');

    // storeCredentials sets up an active account
    manager.saveSession({
      id: 'cached-id',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-12-31T23:59:59Z',
    });
    manager.storeCredentials('CachedUser', 'pass');

    const loaded = manager.loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('cached-id');
    expect(loaded!.username).toBe('CachedUser');
  });

  test('loadSession reads from disk when cache is empty', () => {
    const { manager, path } = makeManager('disk');

    // Write a v2 format file directly
    const store: MultiSessionFile = {
      version: 2,
      activeAccount: 'diskuser',
      accounts: {
        diskuser: {
          username: 'DiskUser',
          password: 'pass',
          session: {
            id: 'disk-id',
            created_at: '2026-01-01T00:00:00Z',
            expires_at: '2026-12-31T23:59:59Z',
          },
        },
      },
    };
    writeFileSync(path, JSON.stringify(store));

    const loaded = manager.loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('disk-id');
    expect(loaded!.username).toBe('DiskUser');
  });

  test('loadSession returns null when no file exists', () => {
    const { manager } = makeManager('empty');
    expect(manager.loadSession()).toBeNull();
  });

  test('clearSession removes file and cache', () => {
    const { manager, path } = makeManager('clear');

    manager.saveSession({
      id: 'to-clear',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-12-31T23:59:59Z',
    });

    expect(existsSync(path)).toBe(true);
    manager.clearSession();
    expect(existsSync(path)).toBe(false);
    expect(manager.loadSession()).toBeNull();
  });

  test('storeCredentials creates account and sets active', () => {
    const { manager, path } = makeManager('creds');

    manager.saveSession({
      id: 'cred-test',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-12-31T23:59:59Z',
    });

    manager.storeCredentials('MyUser', 'MyPass');

    const store = readStore(path);
    expect(store.activeAccount).toBe('myuser');
    expect(store.accounts['myuser'].username).toBe('MyUser');
    expect(store.accounts['myuser'].password).toBe('MyPass');
    expect(store.accounts['myuser'].session?.id).toBe('cred-test');
    // Pending session should be consumed
    expect(store.pendingSession).toBeUndefined();
  });

  test('saveSession creates parent directory if missing', () => {
    const dir = join(TEST_DIR, 'deep', 'nested');
    const path = join(dir, 'session.json');
    const manager = new SessionManager({ sessionPath: path, apiBase: 'http://test:9999', debug: false });

    manager.saveSession({
      id: 'mkdir-test',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-12-31T23:59:59Z',
    });

    expect(existsSync(path)).toBe(true);
  });
});

describe('SessionManager - migration', () => {
  test('migrates v1 format with credentials', () => {
    const { manager, path } = makeManager('migrate-creds');

    // Write old v1 format
    writeFileSync(path, JSON.stringify({
      id: 'old-id',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-12-31T23:59:59Z',
      username: 'OldUser',
      password: 'OldPass',
      player_id: 'pid-123',
    }));

    const loaded = manager.loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('old-id');
    expect(loaded!.username).toBe('OldUser');
    expect(loaded!.password).toBe('OldPass');

    // File should now be v2 format
    const store = readStore(path);
    expect(store.version).toBe(2);
    expect(store.activeAccount).toBe('olduser');
    expect(store.accounts['olduser'].username).toBe('OldUser');
    expect(store.accounts['olduser'].session?.player_id).toBe('pid-123');
  });

  test('migrates v1 format without credentials as pending', () => {
    const { manager, path } = makeManager('migrate-anon');

    writeFileSync(path, JSON.stringify({
      id: 'anon-id',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-12-31T23:59:59Z',
    }));

    const loaded = manager.loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('anon-id');

    const store = readStore(path);
    expect(store.version).toBe(2);
    expect(store.activeAccount).toBeNull();
    expect(store.pendingSession?.id).toBe('anon-id');
  });

  test('v2 format loads without re-migration', () => {
    const { manager, path } = makeManager('v2-load');

    const store: MultiSessionFile = {
      version: 2,
      activeAccount: 'testuser',
      accounts: {
        testuser: {
          username: 'TestUser',
          password: 'pass',
          session: {
            id: 'v2-id',
            created_at: '2026-01-01T00:00:00Z',
            expires_at: '2026-12-31T23:59:59Z',
          },
        },
      },
    };
    writeFileSync(path, JSON.stringify(store));

    const loaded = manager.loadSession();
    expect(loaded!.id).toBe('v2-id');
    expect(loaded!.username).toBe('TestUser');
  });
});

describe('SessionManager - multi-account', () => {
  test('storeCredentials for second user creates second account and switches active', () => {
    const { manager, path } = makeManager('multi');

    // First account
    manager.saveSession({
      id: 'sess-1',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-12-31T23:59:59Z',
    });
    manager.storeCredentials('User1', 'Pass1');

    // Second account — need a new pending session first
    manager.saveSession({
      id: 'sess-2',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2027-12-31T23:59:59Z',
    });

    // storeCredentials for a different user should create a second account
    // but saveSession above updated User1's session since User1 is active.
    // So we need to simulate what happens during login: the session gets updated,
    // then storeCredentials is called with the new username
    manager.storeCredentials('User2', 'Pass2');

    const store = readStore(path);
    expect(store.activeAccount).toBe('user2');
    expect(Object.keys(store.accounts)).toHaveLength(2);
    expect(store.accounts['user1'].username).toBe('User1');
    expect(store.accounts['user2'].username).toBe('User2');
  });

  test('switchAccount changes active account', () => {
    const { manager } = makeManager('switch');

    // Set up two accounts
    manager.saveSession({ id: 's1', created_at: '2026-01-01T00:00:00Z', expires_at: '2026-12-31T23:59:59Z' });
    manager.storeCredentials('Alpha', 'p1');
    manager.storeCredentials('Beta', 'p2');

    expect(manager.getActiveUsername()).toBe('Beta');

    const result = manager.switchAccount('Alpha');
    expect(result).toBe(true);
    expect(manager.getActiveUsername()).toBe('Alpha');
  });

  test('switchAccount returns false for unknown username', () => {
    const { manager } = makeManager('switch-unknown');
    expect(manager.switchAccount('NonExistent')).toBe(false);
  });

  test('switchAccount is case-insensitive', () => {
    const { manager } = makeManager('switch-case');

    manager.saveSession({ id: 's1', created_at: '2026-01-01T00:00:00Z', expires_at: '2026-12-31T23:59:59Z' });
    manager.storeCredentials('MyAgent', 'p1');

    expect(manager.switchAccount('myagent')).toBe(true);
    expect(manager.switchAccount('MYAGENT')).toBe(true);
  });

  test('getAccounts returns correct list', () => {
    const { manager } = makeManager('accounts');

    manager.saveSession({ id: 's1', created_at: '2026-01-01T00:00:00Z', expires_at: '2099-12-31T23:59:59Z' });
    manager.storeCredentials('ActiveUser', 'p1');
    manager.storeCredentials('OtherUser', 'p2');

    // Switch back to first
    manager.switchAccount('ActiveUser');

    const accounts = manager.getAccounts();
    expect(accounts).toHaveLength(2);

    const active = accounts.find(a => a.username === 'ActiveUser');
    expect(active?.isActive).toBe(true);
    expect(active?.hasValidSession).toBe(true);

    const other = accounts.find(a => a.username === 'OtherUser');
    expect(other?.isActive).toBe(false);
  });

  test('getAccounts returns empty list when no accounts', () => {
    const { manager } = makeManager('no-accounts');
    expect(manager.getAccounts()).toHaveLength(0);
  });

  test('hasValidSession returns true for valid session', () => {
    const { manager } = makeManager('has-valid');

    manager.saveSession({ id: 's1', created_at: '2026-01-01T00:00:00Z', expires_at: '2099-12-31T23:59:59Z' });
    manager.storeCredentials('ValidUser', 'p1');

    expect(manager.hasValidSession('ValidUser')).toBe(true);
    expect(manager.hasValidSession('validuser')).toBe(true); // case insensitive
  });

  test('hasValidSession returns false for expired session', () => {
    const { manager } = makeManager('has-expired');

    manager.saveSession({ id: 's1', created_at: '2020-01-01T00:00:00Z', expires_at: '2020-01-02T00:00:00Z' });
    manager.storeCredentials('ExpiredUser', 'p1');

    expect(manager.hasValidSession('ExpiredUser')).toBe(false);
  });

  test('hasValidSession returns false for unknown user', () => {
    const { manager } = makeManager('has-unknown');
    expect(manager.hasValidSession('Ghost')).toBe(false);
  });

  test('loadSession returns pending session when no active account', () => {
    const { manager } = makeManager('pending');

    manager.saveSession({
      id: 'pending-id',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-12-31T23:59:59Z',
    });

    const loaded = manager.loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('pending-id');
    expect(loaded!.username).toBeUndefined();
  });
});

describe('SessionManager - createSession', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  test('calls /session endpoint and saves result', async () => {
    const { manager, path } = makeManager('create');

    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          session: { id: 'new-123', created_at: '2026-01-01T00:00:00Z', expires_at: '2026-12-31T23:59:59Z' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    const session = await manager.createSession();
    expect(session.id).toBe('new-123');
    expect(existsSync(path)).toBe(true);
  });

  test('throws on HTTP error', async () => {
    const { manager } = makeManager('http-err');

    globalThis.fetch = mock(async () =>
      new Response('Server Error', { status: 500 }),
    ) as typeof fetch;

    await expect(manager.createSession()).rejects.toThrow('Failed to create session');
  });

  test('preserves credentials from active account', async () => {
    const { manager } = makeManager('preserve');

    // Set up an active account with credentials
    manager.saveSession({
      id: 'old',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2025-01-01T00:00:00Z',
    });
    manager.storeCredentials('SavedUser', 'SavedPass');

    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          session: { id: 'fresh', created_at: '2026-06-01T00:00:00Z', expires_at: '2026-12-31T23:59:59Z' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    const session = await manager.createSession();
    expect(session.id).toBe('fresh');
    expect(session.username).toBe('SavedUser');
    expect(session.password).toBe('SavedPass');
  });
});

describe('SessionManager - reAuthenticate', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  test('returns null if no credentials', async () => {
    const { manager } = makeManager('no-creds');

    const result = await manager.reAuthenticate({
      id: 'x', created_at: '2026-01-01T00:00:00Z', expires_at: '2026-12-31T23:59:59Z',
    });
    expect(result).toBeNull();
  });

  test('succeeds with credentials', async () => {
    const { manager } = makeManager('reauth-ok');

    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          session: { id: 'reauthed', expires_at: '2026-12-31T23:59:59Z', player_id: 'p1' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    const result = await manager.reAuthenticate({
      id: 'old', created_at: '2026-01-01T00:00:00Z', expires_at: '2026-06-01T00:00:00Z',
      username: 'User', password: 'Pass',
    });

    expect(result).not.toBeNull();
    expect(result!.id).toBe('reauthed');
    expect(result!.player_id).toBe('p1');
  });

  test('returns null on error response', async () => {
    const { manager } = makeManager('reauth-err');

    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({ error: { code: 'auth_failed', message: 'Bad password' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    const result = await manager.reAuthenticate({
      id: 'x', created_at: '2026-01-01T00:00:00Z', expires_at: '2026-06-01T00:00:00Z',
      username: 'User', password: 'Wrong',
    });
    expect(result).toBeNull();
  });

  test('returns null on network error', async () => {
    const { manager } = makeManager('reauth-net');

    globalThis.fetch = mock(async () => { throw new Error('Network error'); }) as typeof fetch;

    const result = await manager.reAuthenticate({
      id: 'x', created_at: '2026-01-01T00:00:00Z', expires_at: '2026-06-01T00:00:00Z',
      username: 'User', password: 'Pass',
    });
    expect(result).toBeNull();
  });
});

describe('SessionManager - getValidSession', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  test('returns cached session when valid', async () => {
    const { manager } = makeManager('valid');

    manager.saveSession({
      id: 'valid-session',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2099-12-31T23:59:59Z',
    });
    manager.storeCredentials('TestUser', 'pass');

    const session = await manager.getValidSession();
    expect(session.id).toBe('valid-session');
  });

  test('returns pending session when valid and no active account', async () => {
    const { manager } = makeManager('valid-pending');

    manager.saveSession({
      id: 'pending-valid',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2099-12-31T23:59:59Z',
    });

    const session = await manager.getValidSession();
    expect(session.id).toBe('pending-valid');
  });

  test('creates new session when none exists', async () => {
    const { manager } = makeManager('no-session');

    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          session: { id: 'new-sess', created_at: '2026-01-01T00:00:00Z', expires_at: '2099-12-31T23:59:59Z' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    const session = await manager.getValidSession();
    expect(session.id).toBe('new-sess');
  });

  test('creates new session when expired', async () => {
    const { manager } = makeManager('expired');

    manager.saveSession({
      id: 'old-expired',
      created_at: '2020-01-01T00:00:00Z',
      expires_at: '2020-01-02T00:00:00Z', // Long expired
    });

    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          session: { id: 'fresh-sess', created_at: '2026-01-01T00:00:00Z', expires_at: '2099-12-31T23:59:59Z' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    const session = await manager.getValidSession();
    expect(session.id).toBe('fresh-sess');
  });
});

describe('SessionManager - credential warning', () => {
  test('warning fires for new account but not on re-login', () => {
    const { manager } = makeManager('cred-warn');

    manager.saveSession({ id: 's1', created_at: '2026-01-01T00:00:00Z', expires_at: '2099-12-31T23:59:59Z' });

    const warnings: string[] = [];
    const origError = console.error;
    console.error = mock((...args: unknown[]) => {
      const msg = args.map(String).join(' ');
      if (msg.includes('Credentials stored in plaintext')) warnings.push(msg);
    }) as typeof console.error;

    // First login with User1 — new account, warning should fire
    manager.storeCredentials('User1', 'pass1');
    expect(warnings).toHaveLength(1);

    // Re-login with User1 — existing account, no second warning
    manager.storeCredentials('User1', 'newpass');
    expect(warnings).toHaveLength(1);

    console.error = origError;
  });
});

describe('SessionStore - save error handling', () => {
  test('throws descriptive error when directory is not writable', () => {
    const dir = join(TEST_DIR, 'save-fail');
    mkdirSync(dir, { recursive: true });
    const store = new SessionStore(join(dir, 'session.json'), false);
    store.load(); // initialize in-memory cache

    // Make directory read-only so writeFileSync fails
    chmodSync(dir, 0o555);
    try {
      expect(() => store.save()).toThrow('Session file write failed');
    } finally {
      chmodSync(dir, 0o755); // restore for cleanup
    }
  });

  test('concurrent saves from separate processes do not collide on the temp file', async () => {
    const dir = join(TEST_DIR, 'save-race');
    mkdirSync(dir, { recursive: true });
    const sessionPath = join(dir, 'session.json');

    // Each subprocess loads and saves the store against the same path,
    // mimicking parallel CLI invocations creating a fresh session at once.
    // With a shared temp filename the loser's rename throws ENOENT.
    const script = `
      const { SessionStore } = await import('${join(import.meta.dir, '..', 'src', 'session-store.ts')}');
      const store = new SessionStore('${sessionPath}', false);
      store.load();
      for (let i = 0; i < 50; i++) store.save();
    `;
    const procs = Array.from({ length: 8 }, () =>
      Bun.spawn(['bun', '-e', script], { stdout: 'pipe', stderr: 'pipe' }),
    );
    const results = await Promise.all(procs.map(async p => ({
      code: await p.exited,
      stderr: await new Response(p.stderr).text(),
    })));

    for (const r of results) {
      expect(r.stderr).not.toContain('Session file write failed');
      expect(r.code).toBe(0);
    }
    // The final session file is intact valid JSON.
    expect(JSON.parse(readFileSync(sessionPath, 'utf-8')).version).toBe(2);
  });
});

describe('SessionStore - gitignore detection', () => {
  test('creates .gitignore when .git exists and no .gitignore present', () => {
    const root = join(TEST_DIR, 'git-create');
    mkdirSync(join(root, '.git'), { recursive: true });
    const store = new SessionStore(join(root, '.spacemolt-session.json'), false);
    store.load();
    store.save();

    const gitignorePath = join(root, '.gitignore');
    expect(existsSync(gitignorePath)).toBe(true);
    expect(readFileSync(gitignorePath, 'utf-8')).toContain('.spacemolt-session.json');
  });

  test('appends to existing .gitignore when entry is missing', () => {
    const root = join(TEST_DIR, 'git-append');
    mkdirSync(join(root, '.git'), { recursive: true });
    writeFileSync(join(root, '.gitignore'), 'node_modules\n.env\n');
    const store = new SessionStore(join(root, '.spacemolt-session.json'), false);
    store.load();
    store.save();

    const content = readFileSync(join(root, '.gitignore'), 'utf-8');
    expect(content).toContain('node_modules');
    expect(content).toContain('.spacemolt-session.json');
  });

  test('does not duplicate entry when already present in .gitignore', () => {
    const root = join(TEST_DIR, 'git-no-dup');
    mkdirSync(join(root, '.git'), { recursive: true });
    writeFileSync(join(root, '.gitignore'), '.spacemolt-session.json\n');
    const store = new SessionStore(join(root, '.spacemolt-session.json'), false);
    store.load();
    store.save();

    const content = readFileSync(join(root, '.gitignore'), 'utf-8');
    const matches = content.split('\n').filter(l => l.trim() === '.spacemolt-session.json');
    expect(matches).toHaveLength(1);
  });

  test('does nothing when no .git directory exists', () => {
    const dir = join(TEST_DIR, 'git-none');
    mkdirSync(dir, { recursive: true });
    const store = new SessionStore(join(dir, '.spacemolt-session.json'), false);
    store.load();
    store.save();

    expect(existsSync(join(dir, '.gitignore'))).toBe(false);
  });

  test('gitignore check only runs on the first save', () => {
    const root = join(TEST_DIR, 'git-once');
    mkdirSync(join(root, '.git'), { recursive: true });
    const store = new SessionStore(join(root, '.spacemolt-session.json'), false);
    store.load();
    store.save(); // first save — creates .gitignore

    // Remove .gitignore to verify a second save does not re-create it
    unlinkSync(join(root, '.gitignore'));
    store.save(); // second save — gitignoreChecked is true, no-ops
    expect(existsSync(join(root, '.gitignore'))).toBe(false);
  });
});
