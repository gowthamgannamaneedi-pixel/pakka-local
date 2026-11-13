#!/usr/bin/env node
// One-time, build-time step: copies Leaflet 1.9.4 (BSD-2-Clause) from the npm registry into frontend/public/vendor/leaflet.
// The files are committed, so the running app never downloads Leaflet. Works on Windows, macOS and Linux (needs npm + tar).
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '1.9.4';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'frontend', 'public', 'vendor', 'leaflet');
const tmp = mkdtempSync(join(tmpdir(), 'leaflet-'));
try {
  // npm pack checks the registry's integrity hash for the tarball
  execSync(`npm pack leaflet@${VERSION} --silent`, { cwd: tmp, stdio: ['ignore', 'ignore', 'inherit'] });   // fixed command, no user input
  execFileSync('tar', ['-xzf', `leaflet-${VERSION}.tgz`], { cwd: tmp });
  const pkg = join(tmp, 'package'), dist = join(pkg, 'dist');
  if (JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version !== VERSION) throw new Error('Downloaded package is not Leaflet ' + VERSION);
  mkdirSync(join(dest, 'images'), { recursive: true });
  for (const f of ['leaflet.js', 'leaflet.js.map', 'leaflet.css']) copyFileSync(join(dist, f), join(dest, f));
  for (const f of readdirSync(join(dist, 'images'))) copyFileSync(join(dist, 'images', f), join(dest, 'images', f));   // marker-icon(-2x).png, marker-shadow.png, layers(-2x).png
  copyFileSync(join(pkg, 'LICENSE'), join(dest, 'LICENSE'));
  console.log(`Leaflet ${VERSION} copied to ${dest}. Commit these files so deployments need no download.`);
} finally { rmSync(tmp, { recursive: true, force: true }); }
