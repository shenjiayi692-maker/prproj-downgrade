// CLI tests: run bin/prproj-downgrade.js on the fixtures in a temp folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gunzipSync, strFromU8 } from 'fflate';
import { getProjectVersion, prodsetVersion } from '../src/prproj.js';

const BIN = fileURLToPath(new URL('../bin/prproj-downgrade.js', import.meta.url));
const FX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'prproj-cli-'));
const versionOf = (file) => getProjectVersion(strFromU8(gunzipSync(new Uint8Array(fs.readFileSync(file)))));

test('--to 2025 writes <name>_2025.prproj next to the input', () => {
  const dir = tmp();
  const input = path.join(dir, 'Edit.prproj');
  fs.copyFileSync(path.join(FX, 'fixture_ppro26.prproj'), input);
  const r = run(input, '--to', '2025');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(versionOf(path.join(dir, 'Edit_2025.prproj')), 43);
  assert.match(r.stdout, /2026 -> 2025/);
  // refuses to overwrite, then --force works
  assert.equal(run(input, '--to', '2025').status, 1);
  assert.equal(run(input, '--to', '2025', '--force').status, 0);
});

test('-o, numeric version and default target', () => {
  const dir = tmp();
  const out = path.join(dir, 'x.prproj');
  assert.equal(run(path.join(FX, 'fixture_ppro26.prproj'), '--to', '42', '-o', out).status, 0);
  assert.equal(versionOf(out), 42);
  const out2 = path.join(dir, 'y.prproj');
  assert.equal(run(path.join(FX, 'fixture_ppro26.prproj'), '-o', out2).status, 0);
  assert.equal(versionOf(out2), 43);
});

test('--info, --list and errors', () => {
  const info = execFileSync(process.execPath, [BIN, path.join(FX, 'fixture_ppro26.prproj'), '--info'], { encoding: 'utf8' });
  assert.match(info, /Project version 45 \(Premiere 2026\)/);
  assert.match(run('--list').stdout, /^2026 +project version 45/m);
  assert.equal(run(path.join(FX, 'fixture_ppro26.prproj'), '--to', '1999').status, 2);
  const r = run(path.join(FX, 'fixture_ppro25.prproj'), '--to', '2026', '-o', path.join(tmp(), 'z.prproj'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Pick an older version/);
});

test('Production folder -> <folder>_downgraded', () => {
  const dir = tmp();
  const prod = path.join(dir, 'MyProd');
  fs.mkdirSync(path.join(prod, 'sub'), { recursive: true });
  fs.copyFileSync(path.join(FX, 'fixture_prproduction.prodset'), path.join(prod, 'MyProd.prodset'));
  fs.copyFileSync(path.join(FX, 'fixture_ppro26.prproj'), path.join(prod, 'sub', 'A.prproj'));
  fs.writeFileSync(path.join(prod, 'notes.txt'), 'hi');
  const r = run(prod, '--to', '2025');
  assert.equal(r.status, 0, r.stderr);
  const out = path.join(dir, 'MyProd_downgraded');
  assert.equal(prodsetVersion(new Uint8Array(fs.readFileSync(path.join(out, 'MyProd_downgraded.prodset')))), 43);
  assert.equal(versionOf(path.join(out, 'sub', 'A.prproj')), 43);
  assert.equal(fs.readFileSync(path.join(out, 'notes.txt'), 'utf8'), 'hi');
});
