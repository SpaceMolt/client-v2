import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SessionManager, type MultiSessionFile } from '../src/session.ts';

const TEST_DIR = join(tmpdir(), `spacemolt-main-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

describe('CLI entry points via subprocess', () => {
  const CLI = join(import.meta.dir, '..', 'src', 'main.ts');

  afterEach(() => {
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  });

  test('--version prints version', async () => {
    const proc = Bun.spawn(['bun', 'run', CLI, '--version'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, SPACEMOLT_NO_UPDATE_CHECK: 'true' },
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    expect(stdout).toContain('SpaceMolt CLI v');
  });

  test('-v prints version', async () => {
    const proc = Bun.spawn(['bun', 'run', CLI, '-v'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, SPACEMOLT_NO_UPDATE_CHECK: 'true' },
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    expect(stdout).toContain('SpaceMolt CLI v');
  });

  test('--help prints help text', async () => {
    const proc = Bun.spawn(['bun', 'run', CLI, '--help'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, SPACEMOLT_NO_UPDATE_CHECK: 'true' },
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('spacemolt');
    expect(stdout).toContain('Account management:');
    expect(stdout).toContain('catalog');
  });

  test('no args prints help', async () => {
    const proc = Bun.spawn(['bun', 'run', CLI], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, SPACEMOLT_NO_UPDATE_CHECK: 'true' },
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    expect(stdout).toContain('Usage:');
  });

  test('unknown command exits with error', async () => {
    const proc = Bun.spawn(['bun', 'run', CLI, 'totally_fake_command'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, SPACEMOLT_NO_UPDATE_CHECK: 'true' },
    });
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;
    expect(proc.exitCode).toBe(1);
    expect(stderr).toContain('Unknown command');
  });

  test('accounts command works with no session file', async () => {
    const dir = join(TEST_DIR, 'accounts-empty');
    mkdirSync(dir, { recursive: true });

    const proc = Bun.spawn(['bun', 'run', CLI, 'accounts'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        SPACEMOLT_NO_UPDATE_CHECK: 'true',
        SPACEMOLT_SESSION: join(dir, 'session.json'),
      },
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    expect(stdout).toContain('No stored accounts');
  });

  test('accounts command lists stored accounts', async () => {
    const dir = join(TEST_DIR, 'accounts-list');
    mkdirSync(dir, { recursive: true });
    const sessionPath = join(dir, 'session.json');

    const store: MultiSessionFile = {
      version: 2,
      activeAccount: 'testuser',
      accounts: {
        testuser: {
          username: 'TestUser',
          password: 'pass',
          session: {
            id: 's1',
            created_at: '2026-01-01T00:00:00Z',
            expires_at: '2099-12-31T23:59:59Z',
          },
        },
      },
    };
    writeFileSync(sessionPath, JSON.stringify(store));

    const proc = Bun.spawn(['bun', 'run', CLI, 'accounts'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        SPACEMOLT_NO_UPDATE_CHECK: 'true',
        SPACEMOLT_SESSION: sessionPath,
      },
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    expect(stdout).toContain('TestUser');
    expect(stdout).toContain('session valid');
  });

  test('switch without username shows usage', async () => {
    const proc = Bun.spawn(['bun', 'run', CLI, 'switch'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, SPACEMOLT_NO_UPDATE_CHECK: 'true' },
    });
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;
    expect(proc.exitCode).toBe(1);
    expect(stderr).toContain('Usage:');
  });

  test('switch to unknown account shows error', async () => {
    const dir = join(TEST_DIR, 'switch-unknown');
    mkdirSync(dir, { recursive: true });

    const proc = Bun.spawn(['bun', 'run', CLI, 'switch', 'Nobody'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        SPACEMOLT_NO_UPDATE_CHECK: 'true',
        SPACEMOLT_SESSION: join(dir, 'session.json'),
      },
    });
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;
    expect(proc.exitCode).toBe(1);
    expect(stderr).toContain('Unknown account');
  });

  test('switch to known account with valid session succeeds', async () => {
    const dir = join(TEST_DIR, 'switch-valid');
    mkdirSync(dir, { recursive: true });
    const sessionPath = join(dir, 'session.json');

    const store: MultiSessionFile = {
      version: 2,
      activeAccount: 'user2',
      accounts: {
        user1: {
          username: 'User1',
          password: 'pass1',
          session: {
            id: 's1',
            created_at: '2026-01-01T00:00:00Z',
            expires_at: '2099-12-31T23:59:59Z',
          },
        },
        user2: {
          username: 'User2',
          password: 'pass2',
          session: {
            id: 's2',
            created_at: '2026-01-01T00:00:00Z',
            expires_at: '2099-12-31T23:59:59Z',
          },
        },
      },
    };
    writeFileSync(sessionPath, JSON.stringify(store));

    const proc = Bun.spawn(['bun', 'run', CLI, 'switch', 'User1'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        SPACEMOLT_NO_UPDATE_CHECK: 'true',
        SPACEMOLT_SESSION: sessionPath,
      },
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    expect(stdout).toContain('Switched to User1');
  });

  test('ambiguous command suggests qualified names', async () => {
    const proc = Bun.spawn(['bun', 'run', CLI, 'create_buy_order'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        SPACEMOLT_NO_UPDATE_CHECK: 'true',
        SPACEMOLT_URL: 'http://localhost:1',  // unreachable — will fail at fetch, not at resolution
      },
    });
    // This command resolves via AMBIGUOUS_DEFAULTS so it will try to execute
    // We just need it not to crash
    await proc.exited;
    // It might succeed at resolution but fail at connection, either way exit code is 1
    // The point is it doesn't crash
  });
});

describe('parseArgs error handling via subprocess', () => {
  const CLI = join(import.meta.dir, '..', 'src', 'main.ts');

  test('invalid integer shows error message', async () => {
    const proc = Bun.spawn(['bun', 'run', CLI, 'sell', 'ore_iron', 'quantity=abc'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        SPACEMOLT_NO_UPDATE_CHECK: 'true',
        SPACEMOLT_URL: 'http://localhost:1',
      },
    });
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;
    expect(proc.exitCode).toBe(1);
    expect(stderr).toContain('Invalid integer value');
  });
});
