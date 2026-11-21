#!/usr/bin/env node
// prproj-downgrade CLI: downgrade a Premiere Pro project (.prproj) or a Production folder.
import fs from 'node:fs';
import path from 'node:path';
import {
  RELEASES, releaseName, inspect, downgrade, downgradeProduction, DowngradeError,
} from '../src/prproj.js';

const HELP = `Usage:
  prproj-downgrade <input.prproj> [--to <release>] [-o <output.prproj>] [--force]
  prproj-downgrade <ProductionFolder> [--to <release>] [-o <output folder>] [--force]
  prproj-downgrade <input.prproj> --info
  prproj-downgrade --list

  --to <release>   target Premiere release, e.g. 2025, 2024, 2020.1, CC
                   (or the internal project version number, e.g. 43).
                   Default: the release just below the project's own.
  -o, --output     output path. Default: <name>_<release>.prproj next to the input,
                   or <folder>_downgraded next to a Production folder.
  --force          overwrite the output if it exists.
  --info           print the project's version and the releases it can go to.
  --list           print the supported releases.
`;

function fail(msg, code = 1) { process.stderr.write(`prproj-downgrade: ${msg}\n`); process.exit(code); }

function parseArgs(argv) {
  const a = { input: null, to: null, output: null, force: false, info: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '-h' || x === '--help') { process.stdout.write(HELP); process.exit(0); }
    else if (x === '--to') a.to = argv[++i];
    else if (x.startsWith('--to=')) a.to = x.slice(5);
    else if (x === '-o' || x === '--output') a.output = argv[++i];
    else if (x === '--force' || x === '-f') a.force = true;
    else if (x === '--info') a.info = true;
    else if (x === '--list') a.list = true;
    else if (x.startsWith('-')) fail(`unknown option ${x}\n\n${HELP}`, 2);
    else if (!a.input) a.input = x;
    else fail(`unexpected argument ${x}`, 2);
  }
  return a;
}

function resolveTarget(s) {
  if (s == null) return undefined;
  const str = String(s).trim();
  const byName = RELEASES.find((r) => r.name.toLowerCase() === str.toLowerCase());
  if (byName) return byName.version;
  if (/^\d+$/.test(str) && RELEASES.some((r) => r.version === Number(str))) return Number(str);
  fail(`unknown release "${s}". Run with --list to see supported releases.`, 2);
}

function listDir(root) {
  const out = [];
  const base = path.basename(root);
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(full, r);
      else if (e.isFile()) out.push({ path: r, bytes: new Uint8Array(fs.readFileSync(full)) });
    }
  };
  walk(root, base);
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    for (const r of [...RELEASES].reverse()) process.stdout.write(`${r.name.padEnd(8)} project version ${r.version}\n`);
    return;
  }
  if (!args.input) { process.stdout.write(HELP); process.exit(2); }
  if (!fs.existsSync(args.input)) fail(`no such file or folder: ${args.input}`);
  const target = resolveTarget(args.to);
  const isDir = fs.statSync(args.input).isDirectory();

  if (args.info) {
    if (isDir) fail('--info works on a single .prproj file');
    const i = inspect(new Uint8Array(fs.readFileSync(args.input)));
    process.stdout.write(`Project version ${i.version} (Premiere ${i.release ?? 'unknown / newer than this tool knows'})\n`);
    process.stdout.write(`Can be downgraded to: ${i.targets.map((t) => t.name).join(', ') || '(nothing older)'}\n`);
    return;
  }

  if (isDir) {
    const inputDir = path.resolve(args.input);
    const r = downgradeProduction(listDir(inputDir), target);
    const outDir = path.resolve(args.output || path.join(path.dirname(inputDir), r.folder));
    if (fs.existsSync(outDir) && !args.force) fail(`${outDir} already exists (use --force to overwrite)`);
    for (const f of r.files) {
      const dest = path.join(outDir, f.path.split('/').slice(1).join('/'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.bytes);
    }
    process.stdout.write(`Production -> Premiere ${releaseName(r.targetVersion)}: ${r.projects} converted, ${r.copied} copied -> ${outDir}\n`);
    for (const e of r.errors) process.stderr.write(`  error: ${e.path}: ${e.error}\n`);
    if (r.errors.length) process.exit(1);
    return;
  }

  const r = downgrade(new Uint8Array(fs.readFileSync(args.input)), target);
  const name = releaseName(r.targetVersion) ?? String(r.targetVersion);
  const out = args.output || path.join(path.dirname(args.input), `${path.basename(args.input).replace(/\.prproj$/i, '')}_${name}.prproj`);
  if (fs.existsSync(out) && !args.force) fail(`${out} already exists (use --force to overwrite)`);
  fs.writeFileSync(out, r.bytes);
  const added = Object.values(r.inserted).reduce((a, b) => a + b, 0);
  if (r.unrecognised) process.stderr.write(`warning: project version ${r.sourceVersion} is newer than this tool knows; result may need checking.\n`);
  process.stdout.write(`Premiere ${releaseName(r.sourceVersion) ?? r.sourceVersion} -> ${name}${added ? ` (re-added ${added} fields)` : ''}: ${out}\n`);
}

try {
  main();
} catch (e) {
  if (e instanceof DowngradeError) fail(e.message);
  throw e;
}
