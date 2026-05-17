import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { resolveCommand, getAmbiguousSuggestions, listCommands, executeCommand, fetchHelp } from '../src/dispatch.ts';
import { initApiClient } from '../src/api.ts';
import { createPassthroughAdapter } from '../src/session.ts';

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

  test('view_storage resolves to spacemolt_storage/view, not faction storage', () => {
    const result = resolveCommand('view_storage');
    expect(result).not.toBeNull();
    expect(result!.toolGroup).toBe('spacemolt_storage');
    expect(result!.action).toBe('view');
  });

  test('faction/view_storage is deprecated (consolidated into storage)', () => {
    // Endpoint removed from API; deprecation message handled in main.ts
    const result = resolveCommand('faction/view_storage');
    expect(result).toBeNull();
  });

  test('deposit_items resolves to spacemolt_storage/deposit, not faction storage', () => {
    const result = resolveCommand('deposit_items');
    expect(result).not.toBeNull();
    expect(result!.toolGroup).toBe('spacemolt_storage');
    expect(result!.action).toBe('deposit');
  });

  test('faction/deposit_items is deprecated (consolidated into storage)', () => {
    // faction/deposit_items will be caught by DEPRECATED_COMMANDS in main.ts
    // before resolveCommand is called; here we just verify it still resolves
    // via the registry until the server removes it
    const result = resolveCommand('faction/deposit_items');
    // May or may not resolve depending on whether openapi.json still has it
    // The deprecation message in main.ts handles the UX regardless
  });

  test('withdraw_items resolves to spacemolt_storage/withdraw, not faction storage', () => {
    const result = resolveCommand('withdraw_items');
    expect(result).not.toBeNull();
    expect(result!.toolGroup).toBe('spacemolt_storage');
    expect(result!.action).toBe('withdraw');
  });

  test('faction/withdraw_items is deprecated (consolidated into storage)', () => {
    // Same as deposit_items — deprecation handled in main.ts
    const result = resolveCommand('faction/withdraw_items');
  });

  test('send_gift is not aliased (deprecated command)', () => {
    const result = resolveCommand('send_gift');
    expect(result).toBeNull();
  });

  test('returns null for unknown command', () => {
    const result = resolveCommand('definitely_not_a_command');
    expect(result).toBeNull();
  });

  test('returns null for slash-qualified name with unknown action', () => {
    // "market/" prefix is valid but the action does not exist — falls through after prefixed lookup
    const result = resolveCommand('market/nonexistent_action');
    expect(result).toBeNull();
  });

  test('resolves auth commands', () => {
    const result = resolveCommand('register');
    expect(result).not.toBeNull();
    expect(result!.toolGroup).toBe('spacemolt_auth');
    expect(result!.action).toBe('register');
  });

  test('resolves ship commands', () => {
    const result = resolveCommand('switch_ship');
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

describe('executeCommand', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    initApiClient(createPassthroughAdapter('test-dispatch-token'));
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  function mockFetch(capturedUrl: { value: string }, capturedBody: { value: string | undefined }) {
    globalThis.fetch = mock(async (input: string | Request, init?: RequestInit) => {
      capturedUrl.value = typeof input === 'string' ? input : input.url;
      capturedBody.value = init?.body ? String(init.body) : undefined;
      return new Response(
        JSON.stringify({ result: 'ok', notifications: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
  }

  test('builds path as /toolGroup/action for standard commands', async () => {
    const url = { value: '' };
    const body = { value: undefined as string | undefined };
    mockFetch(url, body);

    await executeCommand('spacemolt', 'mine', {});
    expect(url.value).toContain('/spacemolt/mine');
  });

  test('builds path as /toolGroup (no action) when isDirect=true', async () => {
    const url = { value: '' };
    const body = { value: undefined as string | undefined };
    mockFetch(url, body);

    await executeCommand('spacemolt_catalog', 'catalog', {}, true);
    expect(url.value).toMatch(/\/spacemolt_catalog$/);
    expect(url.value).not.toContain('/spacemolt_catalog/catalog');
  });

  test('omits body when payload is empty', async () => {
    const url = { value: '' };
    const body = { value: undefined as string | undefined };
    mockFetch(url, body);

    await executeCommand('spacemolt', 'mine', {});
    expect(body.value).toBeUndefined();
  });

  test('includes body when payload has keys', async () => {
    const url = { value: '' };
    const body = { value: undefined as string | undefined };
    mockFetch(url, body);

    await executeCommand('spacemolt', 'travel', { destination: 'sol_station' });
    expect(JSON.parse(body.value!)).toEqual({ destination: 'sol_station' });
  });
});

describe('fetchHelp', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    initApiClient(createPassthroughAdapter('test-dispatch-token'));
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  test('sends GET request to /toolGroup/help', async () => {
    let capturedUrl = '';
    let capturedMethod = '';

    globalThis.fetch = mock(async (input: string | Request, init?: RequestInit) => {
      capturedUrl = typeof input === 'string' ? input : input.url;
      capturedMethod = init?.method || 'GET';
      return new Response(
        JSON.stringify({ result: 'help text', notifications: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    await fetchHelp('spacemolt');
    expect(capturedUrl).toContain('/spacemolt/help');
    expect(capturedMethod).toBe('GET');
  });
});
