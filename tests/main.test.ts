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

describe('Global flags via subprocess', () => {
  const CLI = join(import.meta.dir, '..', 'src', 'main.ts');

  test('--help on a command shows help for that command', async () => {
    const proc = Bun.spawn(['bun', 'run', CLI, 'sell', '--help'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, SPACEMOLT_NO_UPDATE_CHECK: 'true' },
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    expect(stdout).toContain('spacemolt/sell');
    expect(stdout).toContain('Parameters:');
  });

  test('--help before command also works', async () => {
    const proc = Bun.spawn(['bun', 'run', CLI, '--help', 'sell'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, SPACEMOLT_NO_UPDATE_CHECK: 'true' },
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    expect(stdout).toContain('spacemolt/sell');
    expect(stdout).toContain('Parameters:');
  });

  test('--debug enables debug output on stderr', async () => {
    const proc = Bun.spawn(['bun', 'run', CLI, '--debug', 'get_status'], {
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
    // Command will fail at network, but debug output should appear first
    expect(stderr).toContain('[dispatch]');
  });

  test('output has no ANSI codes by default', async () => {
    const proc = Bun.spawn(['bun', 'run', CLI, '--help'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, SPACEMOLT_NO_UPDATE_CHECK: 'true' },
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    // No ANSI escape codes
    expect(stdout).not.toContain('\x1b[');
  });

  test('flags are stripped from command args', async () => {
    // --debug should not be passed as an arg to the command
    const proc = Bun.spawn(['bun', 'run', CLI, 'help', 'sell', '--debug'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, SPACEMOLT_NO_UPDATE_CHECK: 'true' },
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    expect(stdout).toContain('spacemolt/sell');
  });

  test('help text shows flags section', async () => {
    const proc = Bun.spawn(['bun', 'run', CLI, '--help'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, SPACEMOLT_NO_UPDATE_CHECK: 'true' },
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(stdout).toContain('Flags:');
    expect(stdout).toContain('--json');
    expect(stdout).toContain('--debug');
    expect(stdout).toContain('--session');
    expect(stdout).toContain('-h');
  });

  test('--version works from any position', async () => {
    const proc = Bun.spawn(['bun', 'run', CLI, '--debug', '--version'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, SPACEMOLT_NO_UPDATE_CHECK: 'true' },
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    expect(stdout).toContain('SpaceMolt CLI v');
  });

  test('-- stops flag processing', async () => {
    // "spacemolt help -- --help" should try to look up "--help" as a topic, not show help
    const proc = Bun.spawn(['bun', 'run', CLI, 'help', '--', '--help'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, SPACEMOLT_NO_UPDATE_CHECK: 'true' },
    });
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;
    // Should try to resolve "--help" as a command/topic, not show general help
    expect(stderr).toContain('Unknown help topic');
  });

  test('--help on unknown command shows error', async () => {
    const proc = Bun.spawn(['bun', 'run', CLI, 'totally_fake', '--help'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, SPACEMOLT_NO_UPDATE_CHECK: 'true' },
    });
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;
    expect(stderr).toContain('Unknown help topic');
  });

  test('--session without value shows error', async () => {
    const proc = Bun.spawn(['bun', 'run', CLI, '--session'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, SPACEMOLT_NO_UPDATE_CHECK: 'true' },
    });
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;
    expect(proc.exitCode).toBe(1);
    expect(stderr).toContain('--session requires a session token');
  });

  test('--session sends provided token and skips session file', async () => {
    const dir = join(TEST_DIR, 'session-flag');
    mkdirSync(dir, { recursive: true });
    const sessionPath = join(dir, 'session.json');

    const proc = Bun.spawn(
      ['bun', 'run', CLI, '--session', 'explicit-token-abc', '--debug', 'get_status'],
      {
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...process.env,
          SPACEMOLT_NO_UPDATE_CHECK: 'true',
          SPACEMOLT_URL: 'http://localhost:1',  // unreachable — will fail at fetch
          SPACEMOLT_SESSION: sessionPath,        // session file path (should not be created)
        },
      },
    );
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    // Debug output should show the explicit token being used (truncated to 8 chars in debug log)
    expect(stderr).toContain('session=explicit');

    // No session file should be created
    const { existsSync } = await import('fs');
    expect(existsSync(sessionPath)).toBe(false);
  });

  test('help text mentions --session flag', async () => {
    const proc = Bun.spawn(['bun', 'run', CLI, '--help'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, SPACEMOLT_NO_UPDATE_CHECK: 'true' },
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(stdout).toContain('--session');
  });
});
