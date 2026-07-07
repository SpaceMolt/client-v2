import { describe, test, expect } from 'bun:test';
import * as lib from '../src/index.ts';

describe('library entry exports', () => {
  test('re-exports the generated client factory', () => {
    expect(typeof lib.createClient).toBe('function');
  });

  test('re-exports a generated SDK operation', () => {
    expect(typeof lib.spacemoltAuthLogin).toBe('function');
  });

  test('exports the session helper', () => {
    expect(typeof lib.createSession).toBe('function');
  });

  test('exports the socket helper', () => {
    expect(typeof lib.createSocket).toBe('function');
  });
});
