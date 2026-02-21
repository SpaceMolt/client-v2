import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { tryCustomFormatter } from '../src/output/formatters.ts';

describe('tryCustomFormatter', () => {
  let logged: string[];
  const originalLog = console.log;

  beforeEach(() => {
    logged = [];
    console.log = (...args: any[]) => {
      logged.push(args.join(' '));
    };
  });

  afterEach(() => {
    console.log = originalLog;
  });

  test('register formatter activates on password field', () => {
    const handled = tryCustomFormatter('spacemolt_auth/register', {
      username: 'TestUser',
      password: 'abc123',
      empire: 'solarian',
      player_id: 'p1',
    });
    expect(handled).toBe(true);
    expect(logged.some(l => l.includes('TestUser'))).toBe(true);
    expect(logged.some(l => l.includes('abc123'))).toBe(true);
    expect(logged.some(l => l.includes('SAVE THIS PASSWORD'))).toBe(true);
  });

  test('get_status formatter activates on player+ship data', () => {
    const handled = tryCustomFormatter('spacemolt/get_status', {
      player: { username: 'Test', empire: 'solarian', credits: 1000 },
      ship: { name: 'Prospector', class_id: 'starter_mining', hull: 100, max_hull: 100, shield: 50, max_shield: 50, fuel: 80, max_fuel: 100, cargo_used: 5, cargo_capacity: 50 },
      location: { system_name: 'Sol', poi_name: 'Sol Station', docked_at: 'Main Station' },
    });
    expect(handled).toBe(true);
    expect(logged.some(l => l.includes('Test'))).toBe(true);
    expect(logged.some(l => l.includes('Prospector'))).toBe(true);
    expect(logged.some(l => l.includes('Docked'))).toBe(true);
  });

  test('returns false for unknown command', () => {
    const handled = tryCustomFormatter('spacemolt/unknown_action', { some: 'data' });
    expect(handled).toBe(false);
  });

  test('returns false for null data', () => {
    const handled = tryCustomFormatter('spacemolt/get_status', undefined);
    expect(handled).toBe(false);
  });
});
