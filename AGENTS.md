# Agent instructions

## Environment and commands

- Use the Nix environment defined by `devenv.nix`, `devenv.yaml`, and `devenv.lock`.
- Run project commands through `devenv shell -- <command>`, including reads/searches,
  dependency installation, tests, audits, and packaging. Do not substitute a host
  Node.js/npm installation or an ad hoc `nix shell`.
- Bootstrap/update commands for devenv itself and the editor's file patch tool
  may run outside the shell. If the shell fails, diagnose that failure instead of
  silently bypassing it; report any unresolved restriction.
- Install locked dependencies with `devenv shell -- npm ci --ignore-scripts`.
  Shell entry must not install dependencies or launch services automatically.
- Run tests with `devenv shell -- npm test`; run dependency checks with
  `devenv shell -- npm audit --ignore-scripts`.
- Run devenv shell invocations sequentially in this checkout: concurrent shell
  entry can race on `.devenv/load-exports`. Batch safe independent subcommands
  inside one shell instead.
- For `devenv test` in a restricted session that cannot write the global Nix
  cache, use `devenv shell -- sh -c 'XDG_CACHE_HOME="$PWD/.devenv/xdg-cache" devenv test'`.
  This keeps the cache in the writable, ignored project state directory.
- Keep `devenv.lock` checked in. Update Nix/npm dependencies intentionally and
  describe changes; do not regenerate lockfiles as an incidental side effect.

## Project structure

- Runtime extension code is in `src/`; `Firefox/manifest.json` and
  `Chrome/manifest.json` are browser-specific manifest variants, not complete
  extension builds. Keep relevant manifest changes consistent.
- Tests use Vitest and jsdom in `tests/`. `scripts/build.mjs` bundles the pinned
  Transformers.js runtime and packaged ONNX/WASM assets into `dist/`; load complete
  generated browser packages. Model weights are separately downloaded public assets.
- See `SECURITY_AUDIT.md` for the reviewed data flows, findings, and limitations.

## Personal data and security

- Use synthetic fixtures only. Never put real application data, credentials,
  browser profile exports, or API tokens into source, test output, or commits.
- Treat visited-page DOM and field metadata as untrusted. Avoid placing private
  values in DOM hints, console logs, or caches. Filling a field exposes that
  value to the destination page and its scripts.
- Changes to storage, network destinations, automatic suggestions, permissions,
  and frame handling require explicit privacy review and relevant regression
  tests. Do not describe browser sync storage as local-only or encrypted by this
  extension.
- A security audit request authorizes investigation and reporting; distinguish
  suggested remediation from implemented fixes.
