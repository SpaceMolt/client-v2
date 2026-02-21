import { describe, test, expect } from 'bun:test';
import { resolveCommand, getAmbiguousSuggestions, listCommands } from '../src/dispatch.ts';

describe('resolveCommand', () => {
  test('resolves unambiguous short name', () => {
    const result = resolveCommand('travel');
    expect(result).not.toBeNull();
    expect(result!.toolGroup).toBe('spacemolt');
    expect(result!.action).toBe('travel');
  });

  test('resolves qualified name with full tool group', () => {
    const result = resolveCommand('spacemolt_market/view_market');
    expect(result).not.toBeNull();
    expect(result!.toolGroup).toBe('spacemolt_market');
    expect(result!.action).toBe('view_market');
  });

  test('resolves qualified name with short prefix', () => {
    const result = resolveCommand('market/view_market');
    expect(result).not.toBeNull();
    expect(result!.toolGroup).toBe('spacemolt_market');
    expect(result!.action).toBe('view_market');
  });

  test('resolves dot-separated qualified name with spacemolt_ prefix', () => {
    const result = resolveCommand('market.view_market');
    expect(result).not.toBeNull();
    expect(result!.toolGroup).toBe('spacemolt_market');
    expect(result!.action).toBe('view_market');
  });

  test('resolves dot-separated qualified name without prefix', () => {
    // "spacemolt.get_status" should match "spacemolt/get_status"
    const result = resolveCommand('spacemolt.get_status');
    expect(result).not.toBeNull();
    expect(result!.toolGroup).toBe('spacemolt');
    expect(result!.action).toBe('get_status');
  });

  test('returns null for dot-separated unknown command', () => {
    const result = resolveCommand('fake.nonexistent');
    expect(result).toBeNull();
  });

  test('resolves ambiguous command to default', () => {
    // "sell" exists in both spacemolt and spacemolt_salvage, defaults to spacemolt
    const result = resolveCommand('sell');
    expect(result).not.toBeNull();
    expect(result!.toolGroup).toBe('spacemolt');
    expect(result!.action).toBe('sell');
  });

  test('resolves ambiguous command via qualified override', () => {
    // Can still explicitly pick the non-default
    const result = resolveCommand('salvage/sell');
    expect(result).not.toBeNull();
    expect(result!.toolGroup).toBe('spacemolt_salvage');
    expect(result!.action).toBe('sell');
  });

  test('returns null for unknown command', () => {
    const result = resolveCommand('definitely_not_a_command');
    expect(result).toBeNull();
  });

  test('resolves auth commands', () => {
    const result = resolveCommand('register');
    expect(result).not.toBeNull();
    expect(result!.toolGroup).toBe('spacemolt_auth');
    expect(result!.action).toBe('register');
  });

  test('resolves ship commands', () => {
    const result = resolveCommand('buy_ship');
    expect(result).not.toBeNull();
    expect(result!.toolGroup).toBe('spacemolt_ship');
  });

  test('resolves catalog (direct endpoint, no action segment)', () => {
    const result = resolveCommand('catalog');
    expect(result).not.toBeNull();
    expect(result!.toolGroup).toBe('spacemolt_catalog');
    expect(result!.action).toBe('catalog');
    expect(result!.meta.isDirect).toBe(true);
  });

  test('resolves catalog via qualified name', () => {
    const result = resolveCommand('spacemolt_catalog/catalog');
    expect(result).not.toBeNull();
    expect(result!.toolGroup).toBe('spacemolt_catalog');
    expect(result!.meta.isDirect).toBe(true);
  });
});

describe('getAmbiguousSuggestions', () => {
  test('returns multiple suggestions for ambiguous commands', () => {
    const suggestions = getAmbiguousSuggestions('sell');
    expect(suggestions.length).toBeGreaterThan(1);
    expect(suggestions.some(s => s.includes('spacemolt/'))).toBe(true);
    expect(suggestions.some(s => s.includes('spacemolt_salvage/'))).toBe(true);
  });

  test('returns empty array for unknown commands', () => {
    const suggestions = getAmbiguousSuggestions('not_a_command');
    expect(suggestions).toEqual([]);
  });
});

describe('listCommands', () => {
  test('groups commands by tool group', () => {
    const grouped = listCommands();
    expect(grouped.size).toBeGreaterThan(0);
    expect(grouped.has('spacemolt')).toBe(true);
    expect(grouped.has('spacemolt_auth')).toBe(true);
    expect(grouped.has('spacemolt_market')).toBe(true);
  });

  test('each group has commands', () => {
    const grouped = listCommands();
    for (const [group, cmds] of grouped) {
      expect(cmds.length).toBeGreaterThan(0);
      for (const cmd of cmds) {
        expect(cmd.toolGroup).toBe(group);
        expect(cmd.action).toBeTruthy();
      }
    }
  });

  test('ambiguous defaults resolve correctly', () => {
    // create_buy_order should default to market, not faction_commerce
    const result = resolveCommand('create_buy_order');
    expect(result).not.toBeNull();
    expect(result!.toolGroup).toBe('spacemolt_market');

    const result2 = resolveCommand('create_sell_order');
    expect(result2).not.toBeNull();
    expect(result2!.toolGroup).toBe('spacemolt_market');

    // list should default to faction
    const result3 = resolveCommand('list');
    expect(result3).not.toBeNull();
    expect(result3!.toolGroup).toBe('spacemolt_faction');
  });
});
