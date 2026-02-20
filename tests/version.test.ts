import { describe, test, expect } from 'bun:test';
import { compareVersions } from '../src/update-checker.ts';

describe('compareVersions', () => {
  test('equal versions return 0', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  test('handles v prefix', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
  });

  test('newer major version is positive', () => {
    expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
  });

  test('older major version is negative', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
  });

  test('newer minor version is positive', () => {
    expect(compareVersions('1.2.0', '1.1.0')).toBeGreaterThan(0);
  });

  test('newer patch version is positive', () => {
    expect(compareVersions('1.0.2', '1.0.1')).toBeGreaterThan(0);
  });

  test('different segment count', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
  });

  test('v prefix on both', () => {
    expect(compareVersions('v2.0.0', 'v1.5.0')).toBeGreaterThan(0);
  });
});
