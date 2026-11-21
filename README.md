# prproj-downgrade

Downgrade Adobe Premiere Pro project files (`.prproj`) and Premiere Productions so that an
**older** version of Premiere can open them — for example a project saved in Premiere 2026
opened in Premiere 2025. Plain JavaScript, works in Node and in the browser, one small
dependency ([fflate](https://github.com/101arrowz/fflate) for gzip).

**Online version, no install: https://openolder.com** (runs in your browser; files are not uploaded).

> Not affiliated with Adobe. "Adobe" and "Premiere Pro" are trademarks of Adobe and are used
> here only to describe the file format.

This is a JavaScript port of [prem-down](https://github.com/lucuma13/prem-down) by Luis Gómez
Gutiérrez (MIT). All the format knowledge comes from that project; see [Credits](#credits).

## What it does

A `.prproj` file is gzipped XML. Premiere refuses to open a project whose version number is
newer than itself, even when the content would be fine. A downgrade:

1. writes the target release's version into `<Project ObjectID="1" Version="...">`;
2. when going from Premiere **2026** (or newer) to **2025 or older**, re-adds the
   `LowerBound` / `UpperBound` fields of `VideoComponentParam` that 2026 stopped writing but
   older releases require (without them older Premiere reports the project as damaged);
3. verifies the result (the version reads back, a second repair pass changes nothing) and
   throws instead of returning a broken file.

Everything else in the XML is left byte-for-byte unchanged.

**What it does not do:** it cannot make older Premiere understand effects, codecs or features
that only exist in the newer release. Those may be missing or show as offline in the older
version. Keep your original file.

## Install

```sh
npm install prproj-downgrade
```

## CLI

```sh
npx prproj-downgrade "My Edit.prproj" --to 2025          # -> My Edit_2025.prproj
npx prproj-downgrade "My Edit.prproj"                    # one release down
npx prproj-downgrade "My Edit.prproj" --to 2024 -o old.prproj
npx prproj-downgrade "My Edit.prproj" --info             # show version and possible targets
npx prproj-downgrade MyProduction/ --to 2025             # Production folder -> MyProduction_downgraded/
npx prproj-downgrade --list                              # supported releases
```

`--to` takes a release name from the table below (`2025`, `2020.1`, `CC` ...) or the internal
project version number (`43`). Existing output files are not overwritten unless you pass `--force`.

## API (Node)

```js
import fs from 'node:fs';
import { inspect, downgrade } from 'prproj-downgrade';

const bytes = fs.readFileSync('My Edit.prproj');

console.log(inspect(bytes));
// { version: 45, release: '2026', unrecognised: false, targets: [ { version: 43, name: '2025' }, ... ] }

const r = downgrade(bytes, 43);           // target project version; omit for "one release down"
fs.writeFileSync('My Edit_2025.prproj', r.bytes);
console.log(r.sourceVersion, r.targetVersion, r.inserted);
// 45 43 { 'VideoComponentParam/LowerBound': 177, 'VideoComponentParam/UpperBound': 109 }  (counts depend on the project)
```

Productions (a folder with one `.prodset` and any number of `.prproj` files):

```js
import { downgradeProduction } from 'prproj-downgrade';

// paths are relative to the Production folder's parent
const files = [
  { path: 'MyProd/MyProd.prodset', bytes: fs.readFileSync('MyProd/MyProd.prodset') },
  { path: 'MyProd/Edit A.prproj', bytes: fs.readFileSync('MyProd/Edit A.prproj') },
];
const r = downgradeProduction(files, 43);
// r.folder === 'MyProd_downgraded'; r.files = [{ path, bytes }, ...]; r.errors = [...]
```

Every project is downgraded, other files are copied unchanged, the `.prodset` is rewritten
(UTF-16LE for 2025 and older, as Premiere does) and renamed to match the new folder.

Errors are thrown as `DowngradeError` with a `code`: `not-premiere`, `not-older`, `no-older`,
`gzip`, `no-version`, `xml`, `fidelity`, `verify`, `prodset`, `not-production`, `production-too-old`.

Other exports: `RELEASES`, `releaseName(version)`, `previousRelease(version)`,
`newestKnownVersion()`, `getProjectVersion(xml)`, `setProjectVersion(xml, v)`,
`reconstruct(xml)`, `decodeProject(bytes)`, `downgradeProdset(bytes, v)`, `prodsetVersion(bytes)`.

## API (browser)

Same functions, with bytes from a file input. With a bundler:

```js
import { downgrade, releaseName } from 'prproj-downgrade';

input.onchange = async () => {
  const file = input.files[0];
  const r = downgrade(new Uint8Array(await file.arrayBuffer()), 43);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([r.bytes]));
  a.download = file.name.replace(/\.prproj$/i, '') + `_${releaseName(r.targetVersion)}.prproj`;
  a.click();
};
```

Without a bundler, use an import map for `fflate`, e.g.
`<script type="importmap">{"imports":{"fflate":"https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js"}}</script>`.

## Supported versions

Derived from `RELEASES` in `src/prproj.js` (mirrors prem-down's `releases.go`). Any listed
release can be used as a target; the source can be any of them or a newer, not yet listed one
(then `unrecognised: true` is reported).

| Premiere Pro release | Project version |
|---|---|
| 2026 | 45 |
| 2025 | 43 |
| 2024 | 42 |
| 2023 | 41 |
| 2022 | 40 |
| 2021 | 39 |
| 2020.1 | 38 |
| 2020 | 37 |
| 2019.1 | 36 |
| 2019 | 35 |
| 2018.1 | 34 |
| 2018 | 33 |
| 2017 | 32 |
| 2015.1 | 30 |
| 2015 | 29 |
| 2014.1 | 28 |
| 2014 | 27 |
| CC | 26 |
| CS6 | 25 |
| CS5.5 | 24 |
| CS5 | 23 |
| CS4 | 22 |

Productions exist only from 2020.1 (version 38), so that is the oldest Production target.

How well it is tested: the automated tests use real Premiere 2025 and 2026 project and
Production fixtures from prem-down. Opening a downgraded project in real Premiere has been
checked for 2026 → 2025. Jumps across many releases only change the version number (plus the
2026 field repair); very old targets are less tested — please report problems with a sample.

## Tests

```sh
npm install
npm test
```

## Credits

- [prem-down](https://github.com/lucuma13/prem-down) by Luis Gómez Gutiérrez — the original Go
  tool; the version table, field-reconstruction rules, Production handling, test cases and
  fixtures are ported from it. MIT License, Copyright (c) 2026 Luis Gómez Gutiérrez (full text in `LICENSE`).
- [fflate](https://github.com/101arrowz/fflate) — gzip, MIT.

## License

MIT — see `LICENSE` (this project's copyright plus prem-down's MIT notice).
