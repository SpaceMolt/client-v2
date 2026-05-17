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

  test('catalog formatter handles ships', () => {
    const { result, output } = captureOutput(() =>
      tryCustomFormatter('spacemolt_catalog/catalog', {
        type: 'ships',
        items: [
          { name: 'Hawk', tier: 2, category: 'combat', price: 5000, base_hull: 200, base_shield: 100, cargo_capacity: 20, weapon_slots: 3, base_speed: 8 },
        ],
        page: 1,
        total_pages: 1,
        total: 1,
      }),
    );
    expect(result).toBe(true);
    expect(output.some(l => l.includes('Catalog: ships'))).toBe(true);
    expect(output.some(l => l.includes('Hawk'))).toBe(true);
    expect(output.some(l => l.includes('5,000'))).toBe(true);
  });

  test('catalog formatter handles items', () => {
    const { result, output } = captureOutput(() =>
      tryCustomFormatter('spacemolt_catalog/catalog', {
        type: 'items',
        items: [
          { name: 'Iron Ore', id: 'ore_iron', category: 'ore', base_value: 10, description: 'Common ore' },
        ],
        page: 1,
        total_pages: 1,
        total: 1,
      }),
    );
    expect(result).toBe(true);
    expect(output.some(l => l.includes('Iron Ore'))).toBe(true);
    expect(output.some(l => l.includes('Common ore'))).toBe(true);
  });

  test('catalog formatter handles unknown type with generic list', () => {
    const { result, output } = captureOutput(() =>
      tryCustomFormatter('spacemolt_catalog/catalog', {
        type: 'modules',
        items: [
          { name: 'Laser Mk1', id: 'laser_1' },
          { name: 'Shield Mk1', id: 'shield_1' },
        ],
        page: 1,
        total_pages: 1,
        total: 2,
      }),
    );
    expect(result).toBe(true);
    expect(output.some(l => l.includes('Catalog: modules'))).toBe(true);
    expect(output.some(l => l.includes('Laser Mk1'))).toBe(true);
    expect(output.some(l => l.includes('Shield Mk1'))).toBe(true);
  });

  test('catalog formatter returns false without type or items', () => {
    expect(tryCustomFormatter('catalog', { type: 'ships' })).toBe(false);
    expect(tryCustomFormatter('catalog', { items: [] })).toBe(false);
  });

  test('catalog formatter handles skills', () => {
    const { result, output } = captureOutput(() =>
      tryCustomFormatter('spacemolt_catalog/catalog', {
        type: 'skills',
        items: [
          { name: 'Mining', category: 'industry', max_level: 10, description: 'Improves mining yield' },
          { name: 'Combat', max_level: 5 },
        ],
        page: 1,
        total_pages: 1,
        total: 2,
      }),
    );
    expect(result).toBe(true);
    expect(output.some(l => l.includes('Mining'))).toBe(true);
    expect(output.some(l => l.includes('industry'))).toBe(true);
    expect(output.some(l => l.includes('max 10'))).toBe(true);
    expect(output.some(l => l.includes('Improves mining yield'))).toBe(true);
    expect(output.some(l => l.includes('Combat'))).toBe(true);
  });

  test('catalog formatter handles recipes', () => {
    const { result, output } = captureOutput(() =>
      tryCustomFormatter('spacemolt_catalog/catalog', {
        type: 'recipes',
        items: [
          {
            name: 'Iron Plate',
            category: 'materials',
            crafting_time: 5,
            inputs: [{ quantity: 2, item_id: 'ore_iron' }],
            outputs: [{ quantity: 1, item_id: 'iron_plate' }],
          },
          { name: 'Simple Gadget', crafting_time: 2, inputs: [], outputs: [] },
        ],
        page: 1,
        total_pages: 1,
        total: 2,
      }),
    );
    expect(result).toBe(true);
    expect(output.some(l => l.includes('Iron Plate'))).toBe(true);
    expect(output.some(l => l.includes('5 ticks'))).toBe(true);
    expect(output.some(l => l.includes('ore_iron'))).toBe(true);
    expect(output.some(l => l.includes('iron_plate'))).toBe(true);
    expect(output.some(l => l.includes('Simple Gadget'))).toBe(true);
  });

  test('formatter crash returns false rather than throwing', () => {
    // Pass a truthy non-iterable as items — passes the !items guard but throws on for...of
    const result = tryCustomFormatter('spacemolt_catalog/catalog', {
      type: 'ships',
      items: 42, // truthy but not iterable — triggers the catch handler
      page: 1,
      total_pages: 1,
      total: 0,
    });
    expect(result).toBe(false);
  });

  test('catalog formatter shows pagination hint for multi-page results', () => {
    const { result, output } = captureOutput(() =>
      tryCustomFormatter('spacemolt_catalog/catalog', {
        type: 'items',
        items: [{ name: 'Test', id: 'test', category: 'misc', base_value: 1 }],
        page: 1,
        total_pages: 3,
        total: 30,
      }),
    );
    expect(result).toBe(true);
    expect(output.some(l => l.includes('page=N'))).toBe(true);
  });

  test('catalog ship price handles undefined gracefully', () => {
    const { result, output } = captureOutput(() =>
      tryCustomFormatter('spacemolt_catalog/catalog', {
        type: 'ships',
        items: [{ name: 'FreeShip', base_hull: 50, base_shield: 0, cargo_capacity: 10, weapon_slots: 1, base_speed: 5 }],
        page: 1,
        total_pages: 1,
        total: 1,
      }),
    );
    expect(result).toBe(true);
    // Should not contain 'undefined', should show '0 cr'
    expect(output.some(l => l.includes('undefined'))).toBe(false);
    expect(output.some(l => l.includes('0 cr'))).toBe(true);
  });
});
