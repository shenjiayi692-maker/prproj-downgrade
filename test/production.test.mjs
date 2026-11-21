// Production (.prodset) tests, ported from prem-down's production_test.go (MIT) plus folder-level checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { strToU8, strFromU8, gunzipSync } from 'fflate';
import { downgradeProdset, downgradeProduction, getProjectVersion } from '../src/prproj.js';

const fx = (n) => new Uint8Array(fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));
const utf16le = (s) => { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); b[2 * i] = c & 0xff; b[2 * i + 1] = c >> 8; } return b; };
const fromUtf16 = (b) => new TextDecoder('utf-16le').decode(b);

test('real 2026 prodset: only the version keys change, written as UTF-16LE for 2025', () => {
  const original = strFromU8(fx('fixture_prproduction.prodset'));
  const out = downgradeProdset(fx('fixture_prproduction.prodset'), 43);
  assert.equal(out[1], 0, 'expected UTF-16LE output for 2025');
  const want = original.replace('"mMinCompatibleProjectVersion":45', '"mMinCompatibleProjectVersion":43').replace('"mProjectVersion":45', '"mProjectVersion":43');
  assert.equal(fromUtf16(out), want);
});

test('compatibility floor is never raised', () => {
  const out = downgradeProdset(strToU8('{"mMinCompatibleProjectVersion":40,"mProjectVersion":45}'), 43);
  assert.equal(fromUtf16(out), '{"mMinCompatibleProjectVersion":40,"mProjectVersion":43}');
});

test('reads UTF-16 (2025) input', () => {
  const out = downgradeProdset(utf16le('{"mMinCompatibleProjectVersion":43,"mProjectVersion":43}'), 42);
  assert.equal(fromUtf16(out), '{"mMinCompatibleProjectVersion":42,"mProjectVersion":42}');
});

test('refuses targets older than Productions', () => {
  assert.throws(() => downgradeProdset(strToU8('{"mProjectVersion":45}'), 37), (e) => e.code === 'production-too-old');
});

test('whole Production folder: prodset renamed, projects downgraded, other files copied', () => {
  const files = [
    { path: 'MyProd/MyProd.prodset', bytes: fx('fixture_prproduction.prodset') },
    { path: 'MyProd/Edit A.prproj', bytes: fx('fixture_ppro26.prproj') },
    { path: 'MyProd/sub/Edit B.prproj', bytes: fx('fixture_ppro26.prproj') },
    { path: 'MyProd/Old.prproj', bytes: fx('fixture_ppro25.prproj') },
    { path: 'MyProd/notes.txt', bytes: strToU8('hello') },
  ];
  const r = downgradeProduction(files);
  assert.equal(r.targetVersion, 43);
  assert.equal(r.folder, 'MyProd_downgraded');
  assert.deepEqual(r.errors, []);
  const paths = r.files.map((f) => f.path).sort();
  assert.deepEqual(paths, ['MyProd_downgraded/Edit A.prproj', 'MyProd_downgraded/MyProd_downgraded.prodset', 'MyProd_downgraded/Old.prproj', 'MyProd_downgraded/notes.txt', 'MyProd_downgraded/sub/Edit B.prproj']);
  const a = r.files.find((f) => f.path.endsWith('Edit A.prproj'));
  assert.equal(getProjectVersion(strFromU8(gunzipSync(a.bytes))), 43);
  const old = r.files.find((f) => f.path.endsWith('Old.prproj'));
  assert.deepEqual(old.bytes, fx('fixture_ppro25.prproj'), '2025 project copied unchanged');
  assert.equal(strFromU8(r.files.find((f) => f.path.endsWith('notes.txt')).bytes), 'hello');
  assert.equal(r.projects, 3);
  assert.equal(r.copied, 2);
});

test('folder without a prodset is rejected', () => {
  assert.throws(() => downgradeProduction([{ path: 'X/a.prproj', bytes: fx('fixture_ppro26.prproj') }]), (e) => e.code === 'not-production');
});
