# Changelog

All notable changes to `@prokosna/mpd3` are documented in this file.
Versioning follows [Semantic Versioning](https://semver.org/), and the
git tag `vX.Y.Z` matches the `@prokosna/mpd3@X.Y.Z` published to the
npm registry.

## [2.0.0] - 2026-05-01

First release published to the npm registry, under the scoped name
`@prokosna/mpd3`. Existing GitHub-installed consumers
(`npm install github:prokosna/mpd.js#vX.Y.Z`) continue to work
unchanged.

### Breaking changes

- **Package renamed to `@prokosna/mpd3`.** The original unscoped
  name `mpd3` was rejected by the npm name policy as too similar to
  existing popular packages (`d3`, `md5`, `spdy`). All imports must
  be updated from `from "mpd3"` to `from "@prokosna/mpd3"`. There
  are no other source-level breaking changes.

### Added

- Named exports for parser utilities —
  `import { transformToList, ... } from "@prokosna/mpd3"` works
  alongside the existing `import { Parsers } from "@prokosna/mpd3"`
  namespace object.
- `engines.node: ">=18"` declared in `package.json`.

### Changed

- Migrated the dual ESM + CJS build from `tsc` to `tsdown`. `dist/`
  now contains bundled `index.{mjs,cjs,d.mts,d.cts}` (tsdown emits
  explicit `.mjs`/`.cjs` extensions regardless of
  `package.json#type`) instead of per-file output under
  `dist/{esm,cjs}/`. The `exports`, `module`, and `types` fields in
  `package.json` are aligned to those filenames. Only the
  documented `import '@prokosna/mpd3'` entry point was ever
  exposed, so this is internal.
- Linter is now driven by `biome check` (lint + format + assist)
  via `npm run lint` / `npm run lint:fix`; CI no longer runs
  auto-fixers.

### Fixed

- Numerous bugs across the connection / pool / event-monitoring /
  parser layers, including a pool-listener corruption after each
  command, missing line buffering on the idle connection, an
  ineffective system-listener detector, race conditions in
  `EventManager.startMonitoring`, a `MpdError` parser that crashed on
  malformed `ACK` strings, and a `Client.connect` failure path that
  emitted a stray `close` event on a never-returned client. See the
  git log for details.

### Documentation

- Parser list in the README now matches the implementation
  (`aggregateToString` is documented; `aggregateToObject` — which
  never existed — is removed).
- README clarifies that `Client` extends `EventEmitter` and explains
  that `maxRetries` counts retries, so the initial-connect path runs
  up to `1 + maxRetries` total attempts.

## Earlier history

Versions prior to `2.0.0` were distributed only via GitHub
(`prokosna/mpd.js`), not the npm registry. See the project history at
<https://github.com/prokosna/mpd.js> for details.

[2.0.0]: https://github.com/prokosna/mpd.js/releases/tag/v2.0.0
