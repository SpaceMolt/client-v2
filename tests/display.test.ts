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

  test('handles empty response gracefully', () => {
    const { stdout, stderr } = captureAll(() =>
      displayResponse('spacemolt/noop', { notifications: [] } as any),
    );

    // Should not crash, may produce no output
    expect(stderr).toHaveLength(0);
  });
});
