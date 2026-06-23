#!/usr/bin/env bun
/**
 * Rewrites relative import/export specifiers in *.d.ts files under dist/
 * so they are Node-ESM-resolvable (appends .js or /index.js).
 *
 * Rules (checked relative to the file being processed):
 *   if <resolved>.d.ts exists        → append .js
 *   else if <resolved>/index.d.ts exists → append /index.js
 *   else leave unchanged
 */

import { resolve, dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const distDir = resolve(import.meta.dir, '../dist');

// Collect all .d.ts files under dist/
const glob = new Bun.Glob('**/*.d.ts');
const dtsFiles = Array.from(glob.scanSync(distDir)).map((rel) => join(distDir, rel));

// Matches: from '...', export * from '...', import('...')
// Only processes relative specifiers (starting with ./ or ../)
const SPECIFIER_RE = /(?:from\s+|export\s+\*\s+from\s+|import\s*\()(['"])(\.[^'"]+)\1/g;

let totalFiles = 0;
let totalRewritten = 0;

for (const filePath of dtsFiles) {
  const fileDir = dirname(filePath);
  const original = await Bun.file(filePath).text();
  let rewriteCount = 0;

  const updated = original.replace(SPECIFIER_RE, (match, quote, specifier) => {
    // Only handle relative specifiers
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      return match;
    }

    const resolved = resolve(fileDir, specifier);

    let replacement: string | null = null;
    if (existsSync(resolved + '.d.ts')) {
      replacement = specifier + '.js';
    } else if (existsSync(join(resolved, 'index.d.ts'))) {
      replacement = specifier + '/index.js';
    }

    if (replacement !== null) {
      rewriteCount++;
      return match.replace(specifier, replacement);
    }

    return match;
  });

  if (rewriteCount > 0) {
    await Bun.write(filePath, updated);
    totalRewritten += rewriteCount;
  }

  totalFiles++;
}

console.log(
  `fix-dts-extensions: processed ${totalFiles} .d.ts files, rewrote ${totalRewritten} specifiers`,
);
