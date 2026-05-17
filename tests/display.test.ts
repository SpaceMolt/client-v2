import { describe, test, expect, mock } from 'bun:test';
import { displayResponse } from '../src/output/index.ts';

function captureAll(fn: () => void): { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = mock((...args: unknown[]) => { stdout.push(args.map(String).join(' ')); }) as typeof console.log;
  console.error = mock((...args: unknown[]) => { stderr.push(args.map(String).join(' ')); }) as typeof console.error;
  fn();
  console.log = origLog;
  console.error = origErr;
  return { stdout, stderr };
}

describe('displayResponse', () => {
  test('shows notifications first', () => {
    const { stdout } = captureAll(() =>
      displayResponse('spacemolt/mine', {
        result: 'Mined ore',
        notifications: [
          { type: 'poi_arrival', timestamp: '2026-01-01T12:00:00Z', data: { username: 'Agent', poi_name: 'Belt' } },
        ],
      } as any),
    );

    // Notification should come before result
    const arrivalIdx = stdout.findIndex(l => l.includes('ARRIVAL'));
    const resultIdx = stdout.findIndex(l => l.includes('Mined ore'));
    expect(arrivalIdx).toBeGreaterThanOrEqual(0);
    expect(resultIdx).toBeGreaterThan(arrivalIdx);
  });

  test('shows error and stops', () => {
    const { stderr } = captureAll(() =>
      displayResponse('spacemolt/mine', {
        error: { code: 'not_at_belt', message: 'You are not at a mineable location' },
        notifications: [],
      } as any),
    );

    expect(stderr.some(l => l.includes('not at a mineable location'))).toBe(true);
  });

  test('uses custom formatter when available', () => {
    const { stdout } = captureAll(() =>
      displayResponse('spacemolt_auth/register', {
        result: 'raw text',
        structuredContent: { username: 'NewAgent', password: 'secret', empire: 'solarian' },
        notifications: [],
      } as any),
    );

    // Should use register formatter, not raw text
    expect(stdout.some(l => l.includes('Registration successful'))).toBe(true);
    // Should NOT show the raw result text
    expect(stdout.some(l => l === 'raw text')).toBe(false);
  });

  test('falls through to result text when no formatter', () => {
    const { stdout } = captureAll(() =>
      displayResponse('spacemolt/mine', {
        result: 'Mined 3x Iron Ore',
        structuredContent: { some: 'data' },
        notifications: [],
      } as any),
    );

    expect(stdout.some(l => l.includes('Mined 3x Iron Ore'))).toBe(true);
  });

  test('falls back to JSON when no result string', () => {
    const { stdout } = captureAll(() =>
      displayResponse('spacemolt/custom', {
        structuredContent: { items: ['a', 'b'] },
        notifications: [],
      } as any),
    );

    const json = stdout.find(l => l.includes('"items"'));
    expect(json).toBeDefined();
  });

  test('suppresses pending-action placeholder when action_result notification present', () => {
    const { stdout } = captureAll(() =>
      displayResponse('spacemolt/mine', {
        result: 'action pending, resolves next tick',
        structuredContent: { command: 'mine', message: 'action pending, resolves next tick', pending: true },
        notifications: [
          { type: 'action_result', data: { command: 'mine', tick: 42, result: { message: 'Mined 5x ore_iron' } } },
        ],
      } as any),
    );

    // action_result notification should appear
    expect(stdout.some(l => l.includes('Mined 5x ore_iron'))).toBe(true);
    // The "action pending" placeholder should NOT appear
    expect(stdout.some(l => l.includes('action pending'))).toBe(false);
  });

  test('handles empty response gracefully', () => {
    const { stdout, stderr } = captureAll(() =>
      displayResponse('spacemolt/noop', { notifications: [] } as any),
    );

    // Should not crash, may produce no output
    expect(stderr).toHaveLength(0);
  });

  test('--json outputs full response envelope as JSON', () => {
    const { stdout, stderr } = captureAll(() =>
      displayResponse('spacemolt/get_status', {
        result: 'text fallback',
        structuredContent: { player: { username: 'Agent', credits: 500 }, ship: { name: 'Hawk' } },
        notifications: [{ type: 'system', timestamp: '2026-01-01T12:00:00Z', data: { message: 'Hello' } }],
      } as any, { json: true }),
    );

    // Should output the full response as JSON, not formatted text
    const joined = stdout.join('\n');
    const parsed = JSON.parse(joined);
    expect(parsed.structuredContent.player.username).toBe('Agent');
    expect(parsed.structuredContent.ship.name).toBe('Hawk');
    expect(parsed.result).toBe('text fallback');
    // Notifications should be in the JSON, not printed separately
    expect(parsed.notifications).toHaveLength(1);
    // Nothing on stderr (notifications not displayed)
    expect(stderr).toHaveLength(0);
  });

  test('--json includes error in envelope', () => {
    const { stdout } = captureAll(() =>
      displayResponse('spacemolt/mine', {
        error: { code: 'not_at_belt', message: 'You are not at a mineable location' },
        notifications: [],
      } as any, { json: true }),
    );

    const joined = stdout.join('\n');
    const parsed = JSON.parse(joined);
    expect(parsed.error.code).toBe('not_at_belt');
    expect(parsed.error.message).toBe('You are not at a mineable location');
  });
});
