import { describe, test, expect, mock } from 'bun:test';
import { displayNotifications } from '../src/output/notifications.ts';

function captureOutput(fn: () => void): string[] {
  const lines: string[] = [];
  const original = console.log;
  console.log = mock((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  }) as typeof console.log;
  fn();
  console.log = original;
  return lines;
}

describe('displayNotifications', () => {
  test('does nothing with no notifications', () => {
    const lines = captureOutput(() => displayNotifications(undefined));
    expect(lines).toHaveLength(0);
  });

  test('does nothing with empty array', () => {
    const lines = captureOutput(() => displayNotifications([]));
    expect(lines).toHaveLength(0);
  });

  test('handles chat_message', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'chat_message', timestamp: '2026-01-01T12:00:00Z', data: { channel: 'local', sender: 'Agent1', content: 'Hello!' } },
      ]),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('CHAT:local');
    expect(lines[0]).toContain('Agent1');
    expect(lines[0]).toContain('Hello!');
  });

  test('handles crafting_update for a completed job', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'crafting_update', data: { tick: 100, jobs: [
          { job_id: 'j1', recipe: 'Process Copper Wiring', mode: 'craft', venue: 'Copper Wire Mill', storage: 'station', runs_done: 1, runs_remaining: 0, completed: true, deposited: [{ item_id: 'copper_wiring', item_name: 'Copper Wiring', quantity: 2 }] },
        ] } },
      ]),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('CRAFTING');
    expect(lines[0]).toContain('Process Copper Wiring');
    expect(lines[0]).toContain('2x Copper Wiring');
    expect(lines[0]).toContain('station storage');
    // Must not dump raw JSON
    expect(lines[0]).not.toContain('"job_id"');
  });

  test('handles crafting_update for an in-progress job', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'crafting_update', data: { tick: 100, jobs: [
          { job_id: 'j1', recipe: 'Forge Steel', mode: 'craft', venue: 'Iron Refinery', storage: 'station', runs_done: 1, runs_remaining: 3, completed: false, deposited: [] },
        ] } },
      ]),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Forge Steel');
    expect(lines[0]).toContain('3 remaining');
  });

  test('handles combat_update', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'combat_update', data: { attacker: 'Pirate', target: 'Player', damage: 25, damage_type: 'kinetic', shield_hit: 15, hull_hit: 10, destroyed: false } },
      ]),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('COMBAT');
    expect(lines[0]).toContain('Pirate');
    expect(lines[0]).toContain('25');
  });

  test('handles combat_update with destroyed flag', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'combat_update', data: { attacker: 'Boss', target: 'Me', damage: 100, destroyed: true } },
      ]),
    );
    expect(lines[0]).toContain('DESTROYED');
  });

  test('handles player_died - combat', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'player_died', data: { cause: 'combat', killer_name: 'BadGuy', ship_lost: 'Prospector', respawn_base: 'Sol Station' } },
      ]),
    );
    expect(lines.some(l => l.includes('DEATH'))).toBe(true);
    expect(lines.some(l => l.includes('BadGuy'))).toBe(true);
    expect(lines.some(l => l.includes('Prospector'))).toBe(true);
  });

  test('handles player_died - self_destruct', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'player_died', data: { cause: 'self_destruct', respawn_base: 'home' } },
      ]),
    );
    expect(lines.some(l => l.includes('Self-destructed'))).toBe(true);
  });

  test('handles player_died - police', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'player_died', data: { cause: 'police', respawn_base: 'home' } },
      ]),
    );
    expect(lines.some(l => l.includes('police'))).toBe(true);
  });

  test('handles player_died with combat_log', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        {
          type: 'player_died',
          data: {
            cause: 'combat',
            killer_name: 'Raider',
            respawn_base: 'home',
            combat_log: {
              message: 'You were outgunned',
              attacker_ship: 'Destroyer',
              weapons_used: { laser: 3, missile: 1 },
              total_damage: 150,
              shield_damage: 50,
              hull_damage: 100,
              combat_rounds: 5,
              death_location: 'Belt Alpha',
              death_system: 'Sol',
            },
          },
        },
      ]),
    );
    expect(lines.some(l => l.includes('outgunned'))).toBe(true);
    expect(lines.some(l => l.includes('Destroyer'))).toBe(true);
    expect(lines.some(l => l.includes('laser'))).toBe(true);
    expect(lines.some(l => l.includes('150'))).toBe(true);
    expect(lines.some(l => l.includes('Belt Alpha'))).toBe(true);
  });

  test('handles mining_yield', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'mining_yield', data: { quantity: 5, resource_id: 'ore_iron', remaining: 100 } },
      ]),
    );
    expect(lines[0]).toContain('MINED');
    expect(lines[0]).toContain('5');
    expect(lines[0]).toContain('ore_iron');
    expect(lines[0]).toContain('100 remaining');
  });

  test('handles scan_result success', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'scan_result', data: { success: true, username: 'Target1', ship_class: 'Corvette', hull: 80, shield: 30, revealed_info: ['ship', 'hull'] } },
      ]),
    );
    expect(lines.some(l => l.includes('SCAN'))).toBe(true);
    expect(lines.some(l => l.includes('Target1'))).toBe(true);
    expect(lines.some(l => l.includes('Corvette'))).toBe(true);
  });

  test('handles scan_result failure', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'scan_result', data: { success: false, target_id: 'abc' } },
      ]),
    );
    expect(lines[0]).toContain('failed');
  });

  test('handles scan_detected', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'scan_detected', data: { scanner_username: 'Spy', scanner_ship_class: 'Scout', revealed_info: ['cargo', 'ship'] } },
      ]),
    );
    expect(lines.some(l => l.includes('SCANNED'))).toBe(true);
    expect(lines.some(l => l.includes('Spy'))).toBe(true);
  });

  test('handles police_warning', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'police_warning', data: { message: 'Stop or be destroyed', police_level: 3, response_ticks: 2 } },
      ]),
    );
    expect(lines.some(l => l.includes('POLICE'))).toBe(true);
    expect(lines.some(l => l.includes('Stop or be destroyed'))).toBe(true);
  });

  test('handles police_spawn', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'police_spawn', data: { num_drones: 3 } },
      ]),
    );
    expect(lines[0]).toContain('3');
    expect(lines[0]).toContain('police drone');
  });

  test('handles police_combat', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'police_combat', data: { damage: 50, destroyed: true } },
      ]),
    );
    expect(lines[0]).toContain('50');
    expect(lines[0]).toContain('DESTROYED');
  });

  test('handles skill_level_up', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'skill_level_up', data: { skill_id: 'mining', new_level: 5, xp_gained: 100 } },
      ]),
    );
    expect(lines[0]).toContain('LEVEL UP');
    expect(lines[0]).toContain('mining');
    expect(lines[0]).toContain('5');
  });

  test('handles drone_update', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'drone_update', data: { drone_type: 'combat', damage: 15, target_id: 'enemy1' } },
      ]),
    );
    expect(lines[0]).toContain('DRONE');
    expect(lines[0]).toContain('combat');
    expect(lines[0]).toContain('15');
  });

  test('handles drone_destroyed', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'drone_destroyed', data: { drone_type: 'mining', drone_id: 'drone-1' } },
      ]),
    );
    expect(lines[0]).toContain('destroyed');
    expect(lines[0]).toContain('mining');
  });

  test('handles poi_arrival', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'poi_arrival', data: { username: 'Traveler', poi_name: 'Asteroid Belt', clan_tag: 'DMC' } },
      ]),
    );
    expect(lines[0]).toContain('ARRIVAL');
    expect(lines[0]).toContain('[DMC]');
    expect(lines[0]).toContain('Traveler');
  });

  test('handles poi_departure', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'poi_departure', data: { username: 'Leaver', poi_name: 'Station' } },
      ]),
    );
    expect(lines[0]).toContain('DEPARTURE');
    expect(lines[0]).toContain('Leaver');
  });

  test('handles trade_offer_received', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'trade_offer_received', data: { from_name: 'Trader', trade_id: 't1', offer_credits: 100, request_credits: 0 } },
      ]),
    );
    expect(lines.some(l => l.includes('TRADE'))).toBe(true);
    expect(lines.some(l => l.includes('Trader'))).toBe(true);
    expect(lines.some(l => l.includes('100'))).toBe(true);
  });

  test('handles pilotless_ship', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'pilotless_ship', data: { player_username: 'AFK', ship_class: 'Hauler', ticks_remaining: 10 } },
      ]),
    );
    expect(lines.some(l => l.includes('PILOTLESS'))).toBe(true);
    expect(lines.some(l => l.includes('AFK'))).toBe(true);
  });

  test('handles reconnected', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'reconnected', data: { message: 'Welcome back', was_pilotless: true, ticks_remaining: 3 } },
      ]),
    );
    expect(lines.some(l => l.includes('RECONNECTED'))).toBe(true);
    expect(lines.some(l => l.includes('pilotless'))).toBe(true);
  });

  test('handles faction_invite', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'faction_invite', data: { faction_name: 'Cool Gang', faction_id: 'f1' } },
      ]),
    );
    expect(lines.some(l => l.includes('FACTION'))).toBe(true);
    expect(lines.some(l => l.includes('Cool Gang'))).toBe(true);
  });

  test('handles faction_war_declared', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'faction_war_declared', data: { attacker_name: 'Enemy Faction', reason: 'territorial dispute' } },
      ]),
    );
    expect(lines.some(l => l.includes('WAR'))).toBe(true);
    expect(lines.some(l => l.includes('territorial dispute'))).toBe(true);
  });

  test('handles faction_peace_proposed', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'faction_peace_proposed', data: { proposer_name: 'Friends', terms: 'mutual ceasefire', faction_id: 'f2' } },
      ]),
    );
    expect(lines.some(l => l.includes('PEACE'))).toBe(true);
    expect(lines.some(l => l.includes('mutual ceasefire'))).toBe(true);
  });

  test('handles base_raid_update', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'base_raid_update', data: { base_name: 'Outpost', current_health: 50, max_health: 100, damage_per_tick: 5 } },
      ]),
    );
    expect(lines[0]).toContain('RAID');
    expect(lines[0]).toContain('50');
  });

  test('handles base_destroyed', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'base_destroyed', data: { base_name: 'Fort', wreck_id: 'w1' } },
      ]),
    );
    expect(lines.some(l => l.includes('BASE DESTROYED'))).toBe(true);
    expect(lines.some(l => l.includes('w1'))).toBe(true);
  });

  test('handles friend_request', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'friend_request', data: { from_name: 'Buddy' } },
      ]),
    );
    expect(lines[0]).toContain('FRIEND');
    expect(lines[0]).toContain('Buddy');
  });

  test('handles system notification - gameplay_tip', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'system', data: { type: 'gameplay_tip', message: 'Try mining!' } },
      ]),
    );
    expect(lines[0]).toContain('TIP');
    expect(lines[0]).toContain('Try mining!');
  });

  test('handles system notification - generic', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'system', data: { message: 'Server restarting' } },
      ]),
    );
    expect(lines[0]).toContain('SYSTEM');
    expect(lines[0]).toContain('Server restarting');
  });

  test('handles action_result', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'action_result', data: { command: 'mine', tick: 42, result: { message: 'Mined 3 ore' } } },
      ]),
    );
    expect(lines.some(l => l.includes('ACTION'))).toBe(true);
    expect(lines.some(l => l.includes('mine'))).toBe(true);
    expect(lines.some(l => l.includes('Mined 3 ore'))).toBe(true);
  });

  test('handles action_result with object result (no message)', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'action_result', data: { command: 'mine', tick: 42, result: { ore: 'iron', qty: 3 } } },
      ]),
    );
    expect(lines.some(l => l.includes('ore'))).toBe(true);
    expect(lines.some(l => l.includes('iron'))).toBe(true);
  });

  test('handles action_error', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'action_error', data: { command: 'mine', tick: 42, message: 'No resources here' } },
      ]),
    );
    expect(lines[0]).toContain('ACTION FAILED');
    expect(lines[0]).toContain('No resources here');
  });

  test('handles unknown notification with message', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'brand_new_type', data: { message: 'Something happened' } },
      ]),
    );
    expect(lines[0]).toContain('BRAND_NEW_TYPE');
    expect(lines[0]).toContain('Something happened');
  });

  test('handles unknown notification without message', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'mystery', data: { key1: 'val1', key2: 42 } },
      ]),
    );
    expect(lines.some(l => l.includes('MYSTERY'))).toBe(true);
    expect(lines.some(l => l.includes('key1'))).toBe(true);
    expect(lines.some(l => l.includes('val1'))).toBe(true);
  });

  test('handles player_died with clone_cost and insurance_payout', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        {
          type: 'player_died',
          data: {
            cause: 'combat',
            killer_name: 'Pirate',
            respawn_base: 'home',
            clone_cost: 500,
            insurance_payout: 200,
          },
        },
      ]),
    );
    expect(lines.some(l => l.includes('Clone cost'))).toBe(true);
    expect(lines.some(l => l.includes('500'))).toBe(true);
    expect(lines.some(l => l.includes('Insurance payout'))).toBe(true);
    expect(lines.some(l => l.includes('200'))).toBe(true);
  });

  test('handler crash falls back to raw JSON output', () => {
    // scan_result handler calls revealed_info.join() — passing a number makes it throw
    const lines = captureOutput(() =>
      displayNotifications([
        { type: 'scan_result', data: { success: true, revealed_info: 42 } },
      ]),
    );
    expect(lines[0]).toContain('SCAN_RESULT');
  });

  test('handles msg_type field as fallback for type', () => {
    const lines = captureOutput(() =>
      displayNotifications([
        { msg_type: 'chat_message', data: { channel: 'system', sender: 'Bot', content: 'Hi' } },
      ]),
    );
    expect(lines[0]).toContain('CHAT');
    expect(lines[0]).toContain('Bot');
  });
});
