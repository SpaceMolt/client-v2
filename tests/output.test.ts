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

  test('craft formatter renders job-submit from details.message + job line', () => {
    // Real job-submit payload: top-level result is broken ("0 run(s) of  at ..."),
    // but details.message is well-formed. The formatter must use details.
    const handled = tryCustomFormatter('spacemolt/craft', {
      details: {
        action: 'craft',
        job_id: '1adef2f8d04084ac44d777b8ad73c306',
        recipe: 'Process Copper Wiring',
        runs: 1,
        venue: 'Copper Wire Mill',
        produces: [{ item_id: 'copper_wiring', name: 'Copper Wiring', quantity: 2 }],
        est_completion_tick: 1126636,
        message: 'Queued 2 Copper Wiring (1 run(s)) of Process Copper Wiring at Copper Wire Mill — about 1 tick(s) to finish.',
      },
    });
    expect(handled).toBe(true);
    expect(logged.some(l => l.includes('Queued 2 Copper Wiring'))).toBe(true);
    expect(logged.some(l => l.includes('1adef2f8d04084ac44d777b8ad73c306'))).toBe(true);
    expect(logged.some(l => l.includes('1126636'))).toBe(true);
    // Must NOT emit empty interpolation slots
    expect(logged.some(l => l.includes('run(s) of  at'))).toBe(false);
  });

  test('craft formatter renders dry-run quote from details.message', () => {
    const handled = tryCustomFormatter('spacemolt/craft', {
      details: {
        action: 'craft',
        dry_run: true,
        recipe: 'Assemble Solar Panel Array',
        venue: 'Station Workshop',
        have_inputs: false,
        message: 'Quote only — nothing queued. Crafting 1 run(s) of Assemble Solar Panel Array at Station Workshop would consume 3 Circuit Board.',
      },
    });
    expect(handled).toBe(true);
    expect(logged.some(l => l.includes('Quote only'))).toBe(true);
    expect(logged.some(l => l.includes('Assemble Solar Panel Array'))).toBe(true);
  });

  test('craft formatter renders an empty queue list', () => {
    const handled = tryCustomFormatter('spacemolt/craft', {
      details: { action: 'queue', jobs: null },
    });
    expect(handled).toBe(true);
    expect(logged.some(l => l.includes('No crafting jobs'))).toBe(true);
  });

  test('craft formatter renders a populated queue list', () => {
    const handled = tryCustomFormatter('spacemolt/craft', {
      details: {
        action: 'queue',
        jobs: [{
          job_id: 'abc123', recipe: 'Process Copper Wiring', position: 0,
          runs_done: 0, runs_total: 2, progress: 0.5, eta_ticks: 3, status: 'in_progress',
          produces: [{ item_id: 'copper_wiring', name: 'Copper Wiring', quantity: 2 }],
        }],
      },
    });
    expect(handled).toBe(true);
    expect(logged.some(l => l.includes('Crafting queue'))).toBe(true);
    expect(logged.some(l => l.includes('Process Copper Wiring'))).toBe(true);
    expect(logged.some(l => l.includes('50%'))).toBe(true);
    expect(logged.some(l => l.includes('abc123'))).toBe(true);
  });

  test('craft formatter renders bulk results with a failure', () => {
    const handled = tryCustomFormatter('spacemolt/craft', {
      details: {
        action: 'bulk', mode: 'craft',
        summary: { total: 2, succeeded: 1, failed: 1 },
        results: [
          { index: 0, success: true, recipe: 'Process Copper Wiring', runs: 1, job_id: 'j1' },
          { index: 1, success: false, recipe: 'Forge Steel', error_code: 'no_inputs' },
        ],
      },
    });
    expect(handled).toBe(true);
    expect(logged.some(l => l.includes('1/2 queued'))).toBe(true);
    expect(logged.some(l => l.includes('1 failed'))).toBe(true);
    expect(logged.some(l => l.includes('no_inputs'))).toBe(true);
  });

  test('craft formatter returns false when details missing', () => {
    expect(tryCustomFormatter('spacemolt/craft', { some: 'data' })).toBe(false);
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
