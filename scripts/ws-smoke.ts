/**
 * ws-smoke.ts — manual live smoke probe for createSocket against the real SpaceMolt
 * server. NOT a unit test (those are tests/sdk-socket.*.test.ts) and NOT run in CI —
 * it opens a real connection and needs real credentials. The masked password prompt
 * lives HERE in the harness, never in the package (which never touches TTY/env/disk).
 *
 * Usage (run from a real terminal so prompts/secrets stay local):
 *   bun run scripts/ws-smoke.ts --auth anonymous [--endpoint v1|v2] [--duration 8]
 *   bun run scripts/ws-smoke.ts --auth login --user <name> [--endpoint v2] [--subscribe] [--request] [--kick-after 8] [--duration 30]
 *   bun run scripts/ws-smoke.ts --auth login --user <name> --password-file <path>   # non-TTY fallback
 *   bun run scripts/ws-smoke.ts --auth token --token <login_token> [--duration 20]
 *
 * The password (for --auth login) is read via a masked TTY prompt (or --password-file
 * in non-TTY contexts), held in memory for the single login frame, never logged.
 *
 * Reusable-probe potential (intentionally NOT built out yet — see design doc §9.4/§9.5):
 * this could become the canonical "is the live WS contract still true?" probe by
 * gating it behind an explicit flag/env so it can't run in CI, and by folding in a
 * frame tally + exit code. The throwaway scripts/monitor-ws.ts in the sm-cli repo
 * should eventually be refactored to drive createSocket too, so probe and library
 * can't drift. Keep it small until there's a reason to grow it.
 */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { createSocket } from '../src/sdk-socket.ts';
import type { SocketAuth, ServerEvent } from '../src/socket-types.ts';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const promptMasked = (label: string): Promise<string> =>
  new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('stdin is not a TTY — run this directly in your terminal (no piping).'));
      return;
    }
    let muted = false;
    const out = new Writable({
      write(chunk, _enc, cb) {
        if (!muted) process.stdout.write(chunk as Buffer);
        cb();
      },
    });
    const rl = createInterface({ input: process.stdin, output: out, terminal: true });
    process.stdout.write(label);
    muted = true;
    rl.question('', (answer) => {
      muted = false;
      process.stdout.write('\n');
      rl.close();
      resolve(answer);
    });
  });

async function main(): Promise<void> {
  const endpoint = (arg('endpoint', 'v1') as 'v1' | 'v2');
  const mode = arg('auth', 'anonymous');
  const durationMs = Number(arg('duration', '8')) * 1000;
  const baseUrl = arg('base-url', 'https://game.spacemolt.com')!;

  let auth: SocketAuth;
  let who = '';
  if (mode === 'anonymous') {
    auth = { anonymous: true };
    who = 'anonymous (no credential)';
  } else if (mode === 'token') {
    const token = arg('token');
    if (!token) throw new Error('--auth token requires --token <value>');
    auth = { loginToken: token };
    who = 'login_token (redacted)';
  } else if (mode === 'login') {
    const username = arg('user');
    if (!username) throw new Error('--auth login requires --user <name>');
    console.log(
      `\n⚠️  Connecting as "${username}" will DISCONNECT any other live session for this account.\n`,
    );
    // Prefer a masked TTY prompt; fall back to a file (for non-TTY contexts) so the
    // secret stays off the command line. The file is read here, in the throwaway
    // harness — the package itself never touches disk.
    const pwFile = arg('password-file');
    let password: string;
    if (pwFile) {
      const { readFileSync } = await import('node:fs');
      password = readFileSync(pwFile, 'utf8').replace(/\r?\n$/, '');
      console.log(`(read password from ${pwFile} — delete it when done)`);
    } else {
      password = await promptMasked(`Password for "${username}" (hidden): `);
    }
    if (!password) throw new Error('empty password — aborting');
    auth = { username, password };
    who = `login as "${username}" (password redacted)`;
  } else {
    throw new Error(`--auth must be anonymous | login | token (got ${mode})`);
  }

  console.log(`endpoint:  ${endpoint}`);
  console.log(`baseUrl:   ${baseUrl}`);
  console.log(`auth:      ${who}`);
  console.log(`duration:  ${durationMs / 1000}s`);
  console.log(`connecting…\n`);

  const t0 = Date.now();
  const socket = await createSocket({ auth, endpoint, baseUrl });
  console.log(`✓ resolved in ${Date.now() - t0}ms — status=${socket.status}`);

  socket.on('close', (i) => console.log(`[conn] close code=${i.code ?? '?'} reason=${i.reason ?? ''}`));
  socket.on('reconnect', (i) => console.log(`[conn] reconnected after ${i.attempt} attempt(s)`));

  if (flag('subscribe')) {
    socket.subscribeMarket();
    socket.subscribeObservation({ activeScan: false });
    console.log('sent subscribe_market + subscribe_observation (market depth needs you DOCKED)');
  }

  if (flag('request')) {
    // get_status is a query (no tick); resolves on the synchronous ok (v1) / result (v2).
    const frame =
      endpoint === 'v1'
        ? { type: 'get_status', request_id: 'smoke-req-1' }
        : { tool: 'spacemolt', action: 'get_status', request_id: 'smoke-req-1' };
    console.log(`request(): sending get_status with request_id=smoke-req-1 …`);
    socket
      .request(frame, { timeoutMs: 15_000 })
      .then((r) =>
        console.log(
          `✓ request() resolved: type=${r.type} request_id=${String((r as { request_id?: string }).request_id)}`,
        ),
      )
      .catch((e) => console.log(`✗ request() failed: ${e instanceof Error ? e.message : String(e)}`));
  }

  const kickAfter = arg('kick-after');
  if (kickAfter !== undefined) {
    if (mode === 'anonymous') {
      console.log('(--kick-after ignored for anonymous: no account to contend for)');
    } else {
      const kickMs = Number(kickAfter) * 1000;
      setTimeout(() => {
        void (async () => {
          console.log(`\n[kick] opening a 2nd connection for the same account to force-drop the primary…`);
          try {
            // reconnect:false so the kicker doesn't fight back; the server's
            // one-connection-per-account rule closes the primary, which then
            // transparently reconnects (watch for the [conn] reconnected line).
            const kicker = await createSocket({ auth, endpoint, baseUrl, reconnect: false });
            console.log('[kick] 2nd connection authenticated; closing it so the primary keeps the slot');
            setTimeout(() => void kicker.close(1000, 'kick done'), 1500);
          } catch (e) {
            console.log(`[kick] kicker failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        })();
      }, kickMs);
    }
  }

  const tally = new Map<string, number>();
  const deadline = setTimeout(() => {
    void socket.close(1000, 'smoke done');
  }, durationMs);

  for await (const ev of socket as AsyncIterable<ServerEvent>) {
    tally.set(ev.type, (tally.get(ev.type) ?? 0) + 1);
    if (ev.type === 'welcome') {
      const p = (ev.payload ?? {}) as unknown as Record<string, unknown>;
      console.log(`welcome: version=${String(p.version)} tick_rate=${String(p.tick_rate)} current_tick=${String(p.current_tick)}`);
    } else if (ev.type === 'logged_in') {
      console.log('logged_in: ✓ feed is live');
    } else if (ev.type === 'error') {
      console.log(`error frame: ${JSON.stringify(ev.payload)}`);
    } else {
      const preview = JSON.stringify(ev.payload ?? {});
      console.log(`${ev.type}  ${preview.length > 160 ? preview.slice(0, 160) + '…' : preview}`);
    }
  }
  clearTimeout(deadline);

  console.log(`\n── tally (status=${socket.status}) ──`);
  const rows = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) console.log('  (no frames)');
  for (const [k, n] of rows) console.log(`  ${String(n).padStart(4)}  ${k}`);
}

main().catch((e) => {
  console.error(`\n[ws-smoke] error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
