// Tests ported from prem-down's downgrade_test.go (MIT) plus browser-port specific checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import {
  downgrade, inspect, reconstruct, parseXML, render, getProjectVersion, setProjectVersion,
  needsFieldReinsertion, LAST_DENSE, newestKnownVersion, DowngradeError,
} from '../src/prproj.js';

const fx = (n) => new Uint8Array(fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));
const unzip = (b) => strFromU8(gunzipSync(b));

const sparse = `<VideoComponentParam ObjectID="10" ClassID="x" Version="10">
\t<ParameterID>1</ParameterID>
\t<Name>Position</Name>
</VideoComponentParam>`;

test('inserts missing bounds with the instance separator', () => {
  const { xml, stats } = reconstruct(sparse);
  assert.match(xml, /<LowerBound>false<\/LowerBound>/);
  assert.match(xml, /<UpperBound>true<\/UpperBound>/);
  assert.equal(stats['VideoComponentParam/LowerBound'], 1);
  assert.equal(stats['VideoComponentParam/UpperBound'], 1);
  assert.ok(xml.includes('<ParameterID>1</ParameterID>'));
  assert.ok(xml.includes('\n\t<LowerBound>'));
});

test('complete instance stays byte-identical', () => {
  const complete = `<VideoComponentParam ObjectID="10" ClassID="x" Version="10">
\t<ParameterID>1</ParameterID>
\t<LowerBound>-150</LowerBound>
\t<UpperBound>150</UpperBound>
</VideoComponentParam>`;
  const { xml, stats } = reconstruct(complete);
  assert.equal(xml, complete);
  assert.deepEqual(stats, {});
});

test('only the missing bound is inserted', () => {
  const partial = `<VideoComponentParam ObjectID="10" ClassID="x" Version="10">
\t<LowerBound>-150</LowerBound>
</VideoComponentParam>`;
  const { xml, stats } = reconstruct(partial);
  assert.ok(xml.includes('<LowerBound>-150</LowerBound>'));
  assert.ok(xml.includes('<UpperBound>true</UpperBound>'));
  assert.equal(stats['VideoComponentParam/LowerBound'], undefined);
  assert.equal(stats['VideoComponentParam/UpperBound'], 1);
});

test('Lumetri colour class gets the unbounded UpperBound override', () => {
  const color = `<VideoComponentParam ObjectID="10" ClassID="0fde4e9f-f895-4ba3-b0fe-9a6feafda583" Version="10">
\t<Name>Set color</Name>
</VideoComponentParam>`;
  const { xml } = reconstruct(color);
  assert.ok(xml.includes('<UpperBound>18446744073709551615</UpperBound>'));
  assert.ok(xml.includes('<LowerBound>false</LowerBound>'));
});

test('object references are untouched', () => {
  const ref = '<VideoComponentParam ObjectRef="10"/>';
  assert.equal(reconstruct(ref).xml, ref);
});

test('parse/render round trip is byte-identical', () => {
  const s = `<?xml version="1.0"?>\n<A x="1">\n  <B/>\n  <C>t</C>\n</A>\n`;
  assert.equal(parseXML(s).map(render).join(''), s);
  assert.throws(() => parseXML('<A><B></A>'), DowngradeError);
  assert.throws(() => parseXML('<A>'), DowngradeError);
});

test('get/set project version', () => {
  const x = '<PremiereData><Project ObjectID="1" ClassID="y" Version="45"></Project></PremiereData>';
  assert.equal(getProjectVersion(x), 45);
  assert.equal(getProjectVersion(setProjectVersion(x, 43)), 43);
  assert.throws(() => setProjectVersion('<x/>', 43), DowngradeError);
});

test('needsFieldReinsertion boundary', () => {
  assert.equal(needsFieldReinsertion(45, 43), true);
  assert.equal(needsFieldReinsertion(45, 44), false);
  assert.equal(needsFieldReinsertion(43, 42), false);
  assert.equal(LAST_DENSE, 43);
});

test('2025 fixture pass-through: only the version changes', () => {
  const src = fx('fixture_ppro25.prproj');
  const r = downgrade(src, 42);
  const expected = setProjectVersion(unzip(src), 42);
  assert.equal(unzip(r.bytes), expected);
  assert.deepEqual(r.inserted, {});
});

test('2026 fixture -> 2025: every VideoComponentParam has both bounds', () => {
  const r = downgrade(fx('fixture_ppro26.prproj'));
  assert.equal(r.sourceVersion, 45);
  assert.equal(r.targetVersion, 43);
  const out = unzip(r.bytes);
  assert.equal(getProjectVersion(out), 43);
  const defs = out.match(/<VideoComponentParam[ \t\r\n][^>]*\bVersion="\d+"[^>]*>[\s\S]*?<\/VideoComponentParam>/g);
  assert.ok(defs && defs.length > 0);
  let color = 0;
  for (const d of defs) {
    assert.ok(d.includes('<LowerBound>') && d.includes('<UpperBound>'), 'missing bound');
    if (d.includes('ClassID="0fde4e9f-f895-4ba3-b0fe-9a6feafda583"')) {
      color++;
      assert.ok(d.includes('<UpperBound>18446744073709551615</UpperBound>'));
    }
  }
  assert.ok(color > 0, 'expected a Lumetri colour param in the fixture');
  // Outside the reconstructed classes nothing changed: removing inserted leaves gives back the input (with old version).
  const src = setProjectVersion(unzip(fx('fixture_ppro26.prproj')), 43);
  const stripped = out.replace(/\s*<(LowerBound|UpperBound)>(false|true|18446744073709551615)<\/\1>/g, '');
  const srcStripped = src.replace(/\s*<(LowerBound|UpperBound)>(false|true|18446744073709551615)<\/\1>/g, '');
  assert.equal(stripped, srcStripped, 'only LowerBound/UpperBound leaves may differ');
  assert.ok(out.length > src.length);
  assert.ok(r.inserted['VideoComponentParam/LowerBound'] > 0);
});

test('2026 -> 2024 also reinserts', () => {
  const r = downgrade(fx('fixture_ppro26.prproj'), 42);
  assert.equal(getProjectVersion(unzip(r.bytes)), 42);
  assert.ok(r.inserted['VideoComponentParam/UpperBound'] > 0);
});

test('inspect reports version and targets', () => {
  const i = inspect(fx('fixture_ppro26.prproj'));
  assert.equal(i.version, 45);
  assert.equal(i.release, '2026');
  assert.equal(i.targets[0].name, '2025');
});

test('errors: not premiere, target not older, damaged gzip', () => {
  assert.throws(() => downgrade(strToU8('<hello/>')), (e) => e.code === 'not-premiere');
  assert.throws(() => downgrade(fx('fixture_ppro25.prproj'), 45), (e) => e.code === 'not-older');
  const bad = fx('fixture_ppro26.prproj').slice(0, 200);
  assert.throws(() => downgrade(bad), (e) => e.code === 'gzip');
});

test('sparse to sparse (future release -> 2026) only re-gates the version', () => {
  const v = newestKnownVersion() + 2;
  const xml = `<PremiereData Version="3">\n<Project ObjectID="1" ClassID="y" Version="${v}">\n${sparse}\n</Project>\n</PremiereData>`;
  const r = downgrade(gzipSync(strToU8(xml)));
  assert.equal(r.unrecognised, true);
  assert.equal(unzip(r.bytes), setProjectVersion(xml, newestKnownVersion()));
});

test('sparse source jumping the boundary still reinserts', () => {
  const v = newestKnownVersion() + 2;
  const xml = `<PremiereData Version="3">\n<Project ObjectID="1" ClassID="y" Version="${v}">\n${sparse}\n</Project>\n</PremiereData>`;
  const out = unzip(downgrade(strToU8(xml), LAST_DENSE).bytes);
  assert.ok(out.includes('<LowerBound>') && out.includes('<UpperBound>'));
});
