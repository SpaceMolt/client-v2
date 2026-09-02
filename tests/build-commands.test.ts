import { afterEach, describe, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const TEST_ROOT = mkdtempSync(join(tmpdir(), 'spacemolt-build-commands-test-'));

afterEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe('command registry generation', () => {
  test('normalizes an OpenAPI 3.1 nullable scalar type for ParamDef', async () => {
    const fixtureRoot = join(TEST_ROOT, 'nullable-string');
    mkdirSync(join(fixtureRoot, 'scripts'), { recursive: true });
    mkdirSync(join(fixtureRoot, 'src'), { recursive: true });
    copyFileSync(
      join(import.meta.dir, '..', 'scripts', 'build-commands.ts'),
      join(fixtureRoot, 'scripts', 'build-commands.ts'),
    );
    writeFileSync(
      join(fixtureRoot, 'openapi.json'),
      JSON.stringify({
        openapi: '3.1.0',
        info: { version: 'test' },
        paths: {
          '/api/v2/spacemolt_test/set_note': {
            post: {
              operationId: 'spacemolt_test_set_note',
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      properties: {
                        note: {
                          type: ['string', 'null'],
                          description: 'Optional note',
                        },
                        ambiguous: {
                          type: ['integer', 'string', 'null'],
                          description: 'Unsupported multi-type union',
                        },
                        null_only: {
                          type: ['null'],
                          description: 'Malformed null-only union',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        components: { schemas: {} },
      }),
    );

    const proc = Bun.spawn(['bun', 'run', join(fixtureRoot, 'scripts', 'build-commands.ts')], {
      cwd: fixtureRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    expect(proc.exitCode, stderr).toBe(0);
    const generated = readFileSync(join(fixtureRoot, 'src', 'commands.ts'), 'utf-8');
    expect(generated).toContain(
      '"name":"note","type":"string","description":"Optional note"',
    );
    expect(generated).toContain(
      '"name":"ambiguous","type":"string","description":"Unsupported multi-type union"',
    );
    expect(generated).toContain(
      '"name":"null_only","type":"string","description":"Malformed null-only union"',
    );
  });
});
