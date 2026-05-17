import { describe, test, expect } from 'bun:test';
import { c } from '../src/output/colors.ts';

describe('colors', () => {
  test('exports all expected color keys', () => {
    expect(c).toHaveProperty('reset');
    expect(c).toHaveProperty('bright');
    expect(c).toHaveProperty('dim');
    expect(c).toHaveProperty('red');
    expect(c).toHaveProperty('green');
    expect(c).toHaveProperty('yellow');
    expect(c).toHaveProperty('blue');
    expect(c).toHaveProperty('magenta');
    expect(c).toHaveProperty('cyan');
    expect(c).toHaveProperty('white');
  });

  test('all color values are strings', () => {
    for (const [, value] of Object.entries(c)) {
      expect(typeof value).toBe('string');
    }
  });

  // Color is off by default (agent-friendly) — no --color flag or COLOR=true in test env
  test('colors are empty by default (no --color flag)', () => {
    expect(c.red).toBe('');
    expect(c.reset).toBe('');
    expect(c.bright).toBe('');
  });
});
