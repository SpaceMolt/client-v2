import { describe, test, expect } from 'bun:test';
import { resolveCommand, getAmbiguousSuggestions } from '../src/dispatch.ts';

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

  test('resolves dot-separated qualified name', () => {
    const result = resolveCommand('market.view_market');
    expect(result).not.toBeNull();
    expect(result!.toolGroup).toBe('spacemolt_market');
    expect(result!.action).toBe('view_market');
  });

  test('returns null for ambiguous command', () => {
    // "sell" exists in both spacemolt and spacemolt_salvage
    const result = resolveCommand('sell');
    expect(result).toBeNull();
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
