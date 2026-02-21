import { describe, test, expect, mock, afterEach } from 'bun:test';
import { tryCustomFormatter } from '../src/output/formatters.ts';

// Capture console.log output
function captureOutput(fn: () => boolean): { result: boolean; output: string[] } {
  const lines: string[] = [];
  const original = console.log;
  console.log = mock((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  }) as typeof console.log;

  const result = fn();

  console.log = original;
  return { result, output: lines };
}

describe('tryCustomFormatter', () => {
  test('returns false with no data', () => {
    expect(tryCustomFormatter('get_status')).toBe(false);
    expect(tryCustomFormatter('get_status', undefined)).toBe(false);
  });

  test('returns false for unknown command', () => {
    expect(tryCustomFormatter('unknown_command', { foo: 'bar' })).toBe(false);
  });

  test('formats register response', () => {
    const { result, output } = captureOutput(() =>
      tryCustomFormatter('spacemolt_auth/register', {
        username: 'TestAgent',
        password: 'abc123',
        empire: 'solarian',
        player_id: 'pid-1',
      }),
    );

    expect(result).toBe(true);
    expect(output.some(l => l.includes('Registration successful'))).toBe(true);
    expect(output.some(l => l.includes('TestAgent'))).toBe(true);
    expect(output.some(l => l.includes('abc123'))).toBe(true);
    expect(output.some(l => l.includes('solarian'))).toBe(true);
    expect(output.some(l => l.includes('pid-1'))).toBe(true);
  });

  test('register formatter returns false without password', () => {
    expect(tryCustomFormatter('register', { username: 'Test' })).toBe(false);
  });

  test('formats get_status response', () => {
    const { result, output } = captureOutput(() =>
      tryCustomFormatter('spacemolt/get_status', {
        player: { username: 'Agent42', empire: 'crimson', credits: 5000, clan_tag: 'DMC', faction_id: 'drift_miners' },
        ship: { name: 'Hauler', class_id: 'freighter', hull: 80, max_hull: 100, shield: 30, max_shield: 50, fuel: 45, max_fuel: 100, cargo_used: 20, cargo_capacity: 50 },
        location: { system_name: 'Sol', poi_name: 'Earth', docked_at: 'Sol Station' },
      }),
    );

    expect(result).toBe(true);
    expect(output.some(l => l.includes('Agent42'))).toBe(true);
    expect(output.some(l => l.includes('crimson'))).toBe(true);
    expect(output.some(l => l.includes('5000'))).toBe(true);
    expect(output.some(l => l.includes('[DMC]'))).toBe(true);
    expect(output.some(l => l.includes('Hauler'))).toBe(true);
    expect(output.some(l => l.includes('Sol'))).toBe(true);
    expect(output.some(l => l.includes('Docked'))).toBe(true);
  });

  test('get_status formatter returns false without player/ship', () => {
    expect(tryCustomFormatter('get_status', { foo: 'bar' })).toBe(false);
  });

  test('formats get_system response', () => {
    const { result, output } = captureOutput(() =>
      tryCustomFormatter('spacemolt/get_system', {
        name: 'Sol',
        empire: 'solarian',
        pois: [
          { id: 'sol_sun', name: 'Sol Star', type: 'sun', bases: [] },
          { id: 'sol_station', name: 'Sol Station', type: 'station', bases: [{ name: 'Main Hub', id: 'hub1' }] },
        ],
        connections: [
          { name: 'Alpha Centauri', id: 'alpha' },
          { name: 'Sirius', id: 'sirius' },
        ],
      }),
    );

    expect(result).toBe(true);
    expect(output.some(l => l.includes('Sol'))).toBe(true);
    expect(output.some(l => l.includes('solarian'))).toBe(true);
    expect(output.some(l => l.includes('Sol Star'))).toBe(true);
    expect(output.some(l => l.includes('Main Hub'))).toBe(true);
    expect(output.some(l => l.includes('Alpha Centauri'))).toBe(true);
  });

  test('get_system formatter returns false without pois/connections', () => {
    expect(tryCustomFormatter('get_system', { name: 'Sol' })).toBe(false);
  });

  test('extracts action from qualified command name', () => {
    // "spacemolt/register" should match the "register" formatter
    const { result } = captureOutput(() =>
      tryCustomFormatter('spacemolt/register', { username: 'X', password: 'Y' }),
    );
    expect(result).toBe(true);
  });
});
