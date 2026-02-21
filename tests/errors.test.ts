import { describe, test, expect, mock } from 'bun:test';
import { displayError } from '../src/output/errors.ts';

function captureStderr(fn: () => void): string[] {
  const lines: string[] = [];
  const original = console.error;
  console.error = mock((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  }) as typeof console.error;
  fn();
  console.error = original;
  return lines;
}

describe('displayError', () => {
  test('shows error code and message', () => {
    const lines = captureStderr(() =>
      displayError('test', { code: 'some_error', message: 'Something went wrong' }),
    );
    expect(lines[0]).toContain('some_error');
    expect(lines[0]).toContain('Something went wrong');
  });

  test('shows hint for known error codes', () => {
    const lines = captureStderr(() =>
      displayError('test', { code: 'not_authenticated', message: 'Not logged in' }),
    );
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[1]).toContain('Hint');
    expect(lines[1]).toContain('login');
  });

  test('shows hint for docked error', () => {
    const lines = captureStderr(() =>
      displayError('test', { code: 'docked', message: 'You are docked' }),
    );
    expect(lines.some(l => l.includes('undock'))).toBe(true);
  });

  test('shows hint for no_fuel error', () => {
    const lines = captureStderr(() =>
      displayError('test', { code: 'no_fuel', message: 'No fuel' }),
    );
    expect(lines.some(l => l.includes('refuel'))).toBe(true);
  });

  test('no hint for unknown error code', () => {
    const lines = captureStderr(() =>
      displayError('test', { code: 'brand_new_error', message: 'Oops' }),
    );
    expect(lines).toHaveLength(1);
  });

  test('handles missing code gracefully', () => {
    const lines = captureStderr(() =>
      displayError('test', { message: 'No code' }),
    );
    expect(lines[0]).toContain('unknown');
    expect(lines[0]).toContain('No code');
  });

  test('handles missing message gracefully', () => {
    const lines = captureStderr(() =>
      displayError('test', { code: 'some_code' }),
    );
    expect(lines[0]).toContain('some_code');
    expect(lines[0]).toContain('unknown error');
  });

  test('handles completely empty error', () => {
    const lines = captureStderr(() =>
      displayError('test', {}),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('unknown');
  });
});
