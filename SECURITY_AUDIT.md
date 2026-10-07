# Security and privacy audit

## Version 2 remediation review

The historical audit below applies to version **1.29.15**. The working tree now
implements a **2.0.0** redesign; it does not change the previously published package
or store listing. Current flow and limitations are documented in [DESIGN.md](DESIGN.md).

| Finding | Implemented remediation |
| --- | --- |
| A01 | Focus proposals removed; values stay in extension previews until explicit insertion approval; threshold enforced |
| A02 | Optional approved sites; collection scoped to selected form/frame; separate embedded-origin approval; document tokens and exact element checks |
| A03 | Passphrase-encrypted local vault; no profile sync or persisted key; explicit locking |
| A04 | Encrypted-only backups; obsolete plaintext automatically purged at startup and when restored; clear-all covers local/sync/session storage, caches, and active state |
| A05 | Local Transformers.js inference; allowlisted/bounded metadata; pinned integrity-checked setup assets; bundled runtime; no AI endpoints or remote inference fallback |
| A06 | Private payload logs removed; fixed error codes only; personal values removed from context-menu labels |
| A07 | Preview choices use shared stable entry IDs; numeric menu indexing removed |
| A08 | Test/build/runtime dependencies intentionally upgraded and locked; audit rerun required for each release |
| A09 | README, help, privacy policy and design rewritten; corrected store text prepared separately, not published |

### Explicit privacy review

Storage no longer writes personal values or aliases to sync or persistent plaintext
caches. The key and decrypted profile exist only in extension memory; suspension
may relock the vault. Profile encryption does not protect an unlocked compromised
browser. Encrypted-only imports authenticate before replacement. Obsolete plaintext
profiles, migration backups, alias caches, old settings, and sync/session contents
are erased automatically before vault operations, without reading their contents.
Storage changes trigger another cleanup if old data returns. This intentional
destructive upgrade policy is explicitly requested by the user: there is no legacy
retention, conversion, or manual deletion feature. Cleanup preserves the encrypted
vault, current preferences, and public model cache; failures block vault operations
until cleanup succeeds. Previously exported files and other devices remain outside
the cleanup's reach.

There are no automatic suggestions or configured inference destinations. Public
model setup downloads expose ordinary request/IP information to fixed asset hosts,
with no profile or page metadata, credentials, or referrer. Inference reads verified
local assets; executable runtime code is packaged. Matching metadata can still be
private and remains local. Model caches contain only public model assets.

Host access is optional. Browser host patterns can cover multiple ports, so the
controller and content script enforce exact approved origins as well. Each operation
targets a frame, selected form, and document token; embedded destinations need
separate approval. Accepted values are deliberately disclosed to destination scripts.

The old vulnerable-behavior reproductions have been replaced by security-property
tests. Real Firefox validation uses fresh profiles and synthetic forms only; it
does not inspect an installed personal profile. Chrome packaging is built but
real Chrome behavior and store publication remain outside this remediation.

### Remediation validation

Validated with Nix-provided Firefox **155.0.1**, geckodriver **0.37.1**, Node.js
**22.23.2**, and Vitest **5.0.3**. All **38 regression tests pass**. Locked installation
with lifecycle scripts disabled, full npm audit (**zero vulnerabilities**), both
browser package builds, `devenv test`, and `git diff --check` pass. `devenv.lock`
remains unchanged; Firefox/geckodriver were intentionally added to the existing
environment and npm tooling/runtime dependencies were intentionally updated.

The executable Firefox smoke test passed real trusted context selection, preview
secrecy before acceptance, selected-form filling, unrelated-frame isolation,
separate cross-origin-frame approval, navigation rejection, permission revocation,
vault locking, encrypted export, and full deletion. It downloaded the pinned public
model and ran actual WASM embeddings with Firefox offline. Reloading the background
discarded the key and pending operations while preserving the encrypted vault.
Automatic cleanup also removed synthetic old local/sync/session data during the
restart, preserved the encrypted vault byte-for-byte and kept current preferences.
Firefox 128 is the declared minimum; this browser run validated Firefox 155.0.1.

## Historical version 1 audit

Reviewed on 2026-10-06. Source commit:
`a3ce27aae6b4a8d42cff25c6d3d0e1b64ffce9a0`; extension version 1.29.15.

## Assessment for PhD applications

**I would not load a complete confidential application profile into this
extension as it currently stands.** I found no author-controlled collection
endpoint, analytics, remote executable code, or deliberate background upload of
the saved form-value dictionary in the reviewed runtime. However, confirmed
privacy flaws allow personal values to reach visited pages before acceptance,
allow filling beyond the intended form/frame, and retain extra copies of data.
Using a local AI server does not prevent those leaks.

Ordinary name/email data in a separate application-only browser profile, with
automatic suggestions disabled and deliberate single-field insertion, has a
smaller exposure. It still requires checking what actually gets inserted,
because the manual menu can choose the wrong stored value. Do not store passport
or national ID numbers, credentials, payment data, immigration/health details,
confidential essays, or references' private contact information in this version.

This audit added environment configuration, documentation, and reproductions.
It did **not** change runtime behavior or upgrade npm dependencies. Passing the
reproductions confirms the unsafe behavior described below; it does not mean
the extension is secure.

## Scope and published-package comparison

Reviewed every runtime JavaScript file, options HTML/CSS, all three manifests,
the npm dependency lock, tests, README, and privacy policy. Executed the real
background/content functions in Node VM contexts with mocked browser APIs and
jsdom DOMs, using synthetic data only. No real browser profile was inspected,
and no real application data was sent anywhere.

Downloaded the public [Mozilla Firefox 1.29.15 package](https://addons.mozilla.org/firefox/downloads/file/4730028/ai_form_fill_helper-1.29.15.xpi)
without installing it. Its SHA-256 is:

```text
8905fe1fbc7d7e9a63522c6f376800121ecb13a761cc26fa4dbc22277a5d62b5
```

All 20 non-manifest payload files are byte-for-byte identical to `src/`.
The manifest is semantically identical to `Firefox/manifest.json`; only
formatting differs. The remaining archive entries are Mozilla signature
metadata in `META-INF/`. Thus these findings also apply to that downloaded
Firefox release. Signature metadata was not independently cryptographically
verified. The installed version, Chrome store package, future updates, actual
AI server configuration/log retention, and browser-specific exploitation were
not tested. A version number alone is not proof that another package matches.

The [AMO listing](https://addons.mozilla.org/en-US/firefox/addon/ai-form-fill-helper/)
has no Recommended badge. That does not establish whether Mozilla has ever
manually reviewed this particular add-on. Mozilla describes automated
validation and possible manual review for signed add-ons in its
[distribution documentation](https://www.extensionworkshop.com/documentation/publish/signing-and-distribution-overview/);
the [Recommended program](https://support.mozilla.org/en-US/kb/recommended-extensions-program)
adds a dedicated technical security review and ongoing checks.

## Where the information goes

| Destination | Data and trigger | Protection / exposure |
| --- | --- | --- |
| `storage.sync.AIFillForm` | Every saved personal value (dictionary keys in the new format), plus field-name aliases; Save and learning | No extension encryption; eligible for browser account sync, with no extension switch to disable it |
| `storage.sync.settings` | Endpoints, model, threshold, automatic-suggestion and learning settings | Same browser sync area; avoid credentials in endpoint URLs |
| `storage.local.AIFillForm_backup_old_format` and `backup_timestamp` | Complete old-format dictionary when background migration runs | Persistent, unencrypted by the extension; not removed when current form data is cleared |
| `storage.local.staticEmbeddings` | Alias names and embedding vectors | Persistent local cache, normally cleared on Save/learning; not a cache of saved personal values |
| Background memory | Entire profile, dynamic field metadata/embeddings, current settings | Lifetime of background context; no explicit lock or expiry |
| `storage.session.aiSession` | Element metadata through the `getClickedElementData` message case | Memory storage according to the browser API; that message case has no sender in current content code |
| Page DOM | Accepted values; also proposed values in `placeholder` and `data-suggestion` before acceptance | Page scripts, including third-party scripts, can read shared DOM |
| Configured AI endpoint | Lowercased saved aliases and page labels/attribute tokens in POST JSON; model discovery uses GET | Local only if the destination really is local and does not redirect; remote HTTP is permitted |
| Extension/content diagnostic consoles | Complete incoming messages, learned values, failed AI request bodies, failed fill data | Extra copies in developer output; no observed automatic log upload |
| Downloads / OS clipboard | Export contains the complete profile in JSON; copy actions put one value in clipboard | Plaintext export; clipboard history/managers may retain values |

Browser storage is scoped to the extension: a webpage cannot simply read
`chrome.storage.sync` as if it were its own storage. The DOM leak is a separate
path. Mozilla explicitly cautions that
[extension storage is not encrypted](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage).
Browser sync's transport/account encryption is separate from local storage
encryption; this audit does not claim Firefox sync sends plaintext over the
Internet or that Mozilla can read synced data.

### Network inventory

`src/background.js:783` performs POST to the selected `apiUrl` with either
`{"input":"field description"}` or
`{"model":"chosen model","prompt":"field description"}`.
`getStaticEmbeddings` iterates aliases, not the saved value keys. Field label
matching and attribute matching supply additional text. `value`, `outerHtml`,
`selector`, `class`, `type`, and `label` are excluded from the generic attribute
matching loop; labels have their own matching path. Arbitrary remaining
attributes, including `data-*`, are still included.

`src/js/options.js:217` fetches the selected Ollama provider's `tags` path while
loading/changing providers, refreshing models, or importing settings.
`src/background.js:1223` also has a model-list fetch helper, but its models-menu
caller is not used by the current menu creation path. Neither site specifies
`redirect: "error"`, so normal fetch redirect handling applies.

No runtime WebSocket, XHR, beacon, remote script loader, `eval`, or page-to-
extension `postMessage` bridge was found. Help links are ordinary navigation,
not background telemetry. Static HTML's example localhost URLs are commented
out; a new profile has an empty endpoint list. Requests can nevertheless occur
without an explicit per-field command when automatic suggestions are enabled,
and alias embedding initialization can occur during menu initialization.

## Confirmed findings

Severity describes impact and prerequisites in this application, not a formal
CVSS score. Confidence is high for the code behaviors reproduced below; a
complete browser attack and network capture remain outside this audit.

### A01 — High: automatic suggestions disclose values before acceptance

Evidence: `src/content.js:985`, `:1033`, `:1048`, `:1076`; background direct
matching at `src/background.js:470`.

With `Calculate similarities on focus` enabled, focusing an input asks the
background for a stored value. `showProposal` puts that value into the input's
`data-suggestion` and placeholder while the actual input value remains empty.
Any page script can read it immediately. The handler also ignores the configured
similarity threshold: the reproduction exposes a 0.01 match at a 0.9 threshold.

A hostile permitted page can create predictable fields such as `fullName` or
`email` and dispatch focus events to request suggestions. There is no visible-
field or empty-field guard before requesting a match. The reproduction executes
the listener with an untrusted synthetic focus event. Knowing or guessing
configured aliases is sufficient for exact matching; no AI inference is needed
for those matches. This is not a claim that ordinary pages can directly call
the background message API.

Remediation: require a deliberate extension-controlled action on an approved
origin, retain proposed values in extension-owned UI until acceptance, and
enforce the threshold before disclosure. A shadow DOM attached to the page is
not a replacement for an extension security boundary. Checking `isTrusted`
alone also does not establish meaningful user consent.

### A02 — High: form filling and proposals cross the intended frame boundary

Evidence: all manifests specify `all_frames: true` and all-site access;
`src/background.js:1010`, `:1068`, `:1194`; `src/content.js:758`, `:818`.

Whole-form filling sends `collectFields` to the entire tab without `frameId`.
Every injected frame can return candidates; the background then fills each
responding frame. Collection covers the entire frame document, not just the
form containing the clicked input. An unrelated third-party iframe with
eligible fields may therefore receive personal values. Visibility checks reject
obvious hidden fields but do not establish that the user can see a field in the
viewport or that it belongs to the intended form.

Automatic `showProposal` messages also omit the requesting frame, broadcasting
personal values to content scripts in other frames. A colliding ID or selector
can place the value in another frame's DOM if that frame has suggestions
enabled. MDN documents that
[omitting `frameId` sends to all frames](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/sendMessage).
The reproductions verify both broadcast calls. Single-field context menu
fetch/fill and clipboard operations already specify `info.frameId`, and bulk
fill responses specify `sender.frameId`; these do not fix initial collection
or automatic proposal broadcasts.

Remediation: collect only from the clicked frame and selected form; bind every
reply to the authorized origin/frame and, where supported, document ID. Account
for navigation during asynchronous AI calls and require separate consent for
cross-origin frames. Replace persistent all-site access with optional approved
sites or deliberate `activeTab` injection where practical.

### A03 — Medium: the complete profile is stored without extension encryption and is sync eligible

Evidence: `src/js/options.js:154`, `src/background.js:697`, `:713`, `:747`.

The extension always uses `storage.sync` for personal data. There is no local-
only storage choice or extension-level sync opt-in. Actual upload depends on
browser/account settings; simply using the sync API does not prove an upload
happened. Local profile access, backups, unlocked devices, or compromise of
another synced device can expose the profile. This is particularly consequential
for applications containing identity, demographic, or other private details.

Remediation: default personal data to local storage, make sync an explicit
separate choice, minimize retained fields, and consider memory-only storage
or an encrypted vault with a key not stored beside its ciphertext. Local-only
storage alone does not supply encryption at rest.

### A04 — Medium: clearing current data leaves migration backups; exports create plaintext copies

Evidence: `src/background.js:708`, `src/js/options.js:46`, `:158`, `:519`, `:544`.

Background migration writes `AIFillForm_backup_old_format` and `backup_timestamp`
to local storage. No code removes these keys later. Saving `{}` removes the
current values and static embedding cache but leaves the old complete profile.
The reproduction migrates a synthetic name, clears the active dictionary, and
still retrieves the name from the backup.

The Reset button only changes the options textarea; it does not erase persisted
data until Save. Export intentionally downloads unencrypted JSON containing all
values; exports, downloaded-file backups, and clipboard history are additional
retention locations outside browser storage.

Remediation: remove migration backups once conversion succeeds, add a clear-all-
personal-data action that covers every storage area/cache, and disclose/export
plaintext only with a clear warning or offer an encrypted format. Clearing
browser storage cannot erase already copied files or another device's backups.

### A05 — Medium: metadata may contain private data; endpoint warnings can be bypassed

Evidence: `src/content.js:784`; `src/background.js:441`, `:493`, `:498`, `:783`;
`src/js/options.js:396`, `:432`, `:609`.

The AI endpoint receives aliases, labels, and arbitrary attribute tokens.
Although saved values are not directly included, a label or `data-*` attribute
can contain an applicant name, identifier, or token. A reproduction confirms
`data-applicant="privateSurname"` becomes `{"input":"privatesurname"}`.
Automatic focus can trigger transmission. There is no narrowly defined safe
metadata allowlist, payload limit, request timeout, or per-site data-send consent.

Adding an endpoint through the dialog warns about remote/HTTP destinations, but
the hostname check treats any name beginning with `10.` or `192.168.` as local.
The real options helper misclassifies `https://10.attacker.example/embeddings`
as both local and secure, suppressing the dialog's warning. Private LAN servers
are also treated as local, although their traffic leaves the device. Imported
endpoints bypass that dialog entirely; an imported selected Ollama provider can
trigger a model-list GET before Save. Background POST has no equivalent endpoint
validation, and redirects are not forbidden.

Remediation: allowlist required metadata, validate destinations at the network
call as well as in every configuration path, permit exact loopback hosts by
default, distinguish LAN from on-device services, and block redirects for
local-only operation. Require clear consent and HTTPS for an intentionally
remote provider. Do not put API credentials into URLs.

### A06 — Medium: diagnostic logs contain personal values

Evidence: `src/content.js:68`; `src/background.js:702`, `:800`, `:1005`.

The content message listener logs complete `fillFields`, `showProposal`, and
clipboard messages. Learning logs the stored value verbatim. Failed AI calls
log request bodies/endpoints, and failed fills log proposed data. The learning
log is reproduced with a synthetic personal value. Console output is an extra
copy accessible in developer tools or captured logs; I found no automatic log
upload and do not claim ordinary page scripts can intercept isolated content-
script consoles. Manual menu labels also reveal values to shoulder surfing.

Remediation: log action names and non-sensitive error codes, redact payloads,
and avoid full response bodies that can echo private request text.

### A07 — Medium: manual menu selection inserts a different stored value

Evidence: `src/background.js:628`, `:887`.

Menu creation sorts profile values before assigning `value_0`, `value_1`, etc.
Click handling resolves the same numeric ID against unsorted `Object.keys`.
With insertion order `Zebra Example`, then `Applicant Example`, the menu labeled
`Applicant Example` inserts `Zebra Example`. This can disclose an unintended
private value, corrupt application fields, and teach the wrong mapping when
auto-learning is enabled. The reproduction executes menu creation and the real
click processing function.

Remediation: use a stable menu-ID-to-value mapping shared by creation and click
handling, rather than indexing two differently ordered lists.

### A08 — Development tooling: npm reports high and critical advisories

`devenv shell -- npm audit --ignore-scripts --json` reported **15 affected
packages: 4 moderate, 8 high, 3 critical**, including inherited severities.
These are affected-package counts, not 15 independently demonstrated exploits.
All npm dependencies are development tools; the extension directly loads its
own scripts and does not ship `node_modules` in the reviewed Firefox package.
`devenv shell -- npm audit --omit=dev --ignore-scripts` reported zero findings.

| Scanner severity | Affected packages |
| --- | --- |
| Critical | `vitest`, `@vitest/ui`, `tinypool` |
| High | `vite`, `flatted`, `form-data`, `nanoid`, `picomatch`, `postcss`, `source-map-js`, `ws` |
| Moderate | `@vitest/mocker`, `vite-node`, `esbuild`, `fflate` |

The installed Vitest version is 2.1.9. Its maintainer describes
[file access/execution risks when the UI/API server is exposed, and additional Windows conditions](https://github.com/vitest-dev/vitest/security/advisories/GHSA-5xrq-8626-4rwp).
The esbuild maintainer describes
[cross-origin access to its development server](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99).
Do not infer that these advisories prove remote execution through normal form
filling or through the one-shot `npm test` command used here. Other advisories
have their own prerequisites and were not individually exploited.

Remediation: intentionally upgrade the test stack and transitive dependencies,
then validate compatibility. Avoid running the vulnerable UI/development server
alongside private browser activity or exposing its API. Do not use an unreviewed
`npm audit fix --force` as a substitute for that migration. Advisory databases
change; rerun the command when deciding what versions to use.

### A09 — Low: privacy descriptions overstate the guarantees

`others/privacy.md` says field access is explicitly triggered and describes
permissions as minimal. Automatic focus handlers and persistent all-site/all-
frame injection are broader. It also describes deletion without identifying
the retained migration backup. The current
[AMO description](https://addons.mozilla.org/en-US/firefox/addon/ai-form-fill-helper/)
claims data stays on the device, whereas the implementation supports browser
sync and arbitrary remote endpoints. README's “optionally sync” wording reflects
browser configuration, not a switch provided by the extension.

Remediation: update the listing, README, privacy policy, and help text to
describe automatic requests, sync, DOM disclosure, plaintext exports, and all
deletion locations accurately.

## Precautions if using the current version

1. Use a dedicated browser profile only for trusted application portals, without
   signing it into browser sync. Do not browse unrelated sites in that profile.
2. Leave `Calculate similarities on focus` disabled, and disable auto-learning.
   Reload all application tabs after changing settings; previously loaded frames
   may still have old listeners. The context-menu toggle actually persists the
   setting, despite the README describing a temporary toggle.
3. Keep only low-sensitivity values. Use deliberate single-field insertion and
   inspect each result. Avoid whole-form filling until frame/form scoping and
   the manual-menu mismatch are fixed. The destination page can always read
   whatever you deliberately insert, even before submission.
4. Use an exact loopback endpoint such as `http://127.0.0.1:1234/v1/embeddings`,
   with the AI server bound to loopback, no redirect/proxy to a cloud service,
   and no unnecessary request logging. Review the AI server separately. Do not
   import endpoint configuration from untrusted files.
5. Avoid exports and clipboard copy for private values; if used, manage the
   resulting files, backups, and clipboard history explicitly. Use full-disk
   encryption and protect the profile against other local users.
6. Pin the reviewed artifact while evaluating it and review any update before
   trusting it with the profile. Verify fixes before increasing data sensitivity.

These reduce exposure but do not make this version suitable for a confidential
application vault. The preferred next work is A01/A02/A07 first, then local-
only storage, complete deletion, redacted logs, strict endpoints/metadata, and
dependency upgrades, followed by real Firefox tests with synthetic forms.

### Clearing retained extension data

The options page's Save of `{}` does not remove the migration backup. If you
already stored sensitive data, use the **extension's own debugging console**
under `about:debugging` (not a website console) to clear it. The following
destructive cleanup also removes settings; do it only when that is desired:

```js
await chrome.storage.sync.clear();
await chrome.storage.local.clear();
await chrome.storage.session.clear();
```

Then disable/reload the extension and reload or close affected pages to clear
cached objects and DOM suggestions. Check synced devices and any exported JSON,
clipboard history, captured logs, or profile backups separately. This is logical
deletion, not a guarantee of forensic erasure from disk or existing backups.
No cleanup was performed on your browser during this audit.

## Reproduction and validation

```sh
devenv shell -- npm ci --ignore-scripts
devenv shell -- npm test
devenv shell -- npm audit --ignore-scripts
devenv shell -- npm audit --omit=dev --ignore-scripts
```

All **59 tests pass**: 49 existing tests and 10 executable audit reproductions
in `tests/security-audit.test.js`. The reproductions exercise DOM disclosure,
synthetic focus, frame broadcasts, retained migration data, alias-only request
payloads, arbitrary metadata transmission, value logging, the manual menu
mismatch, and the hostname classifier. They execute real runtime functions;
browser message delivery, network responses, and browser storage are mocked.
When fixing a finding, replace its vulnerable-behavior assertion with an
assertion of the required security property.

Environment validation used devenv 2.4.0, Node.js 22.23.2, npm 10.9.8, and the
generated `devenv.lock`. The `project:test` task also passed through `devenv test`
with the writable-cache override documented in `AGENTS.md`. Dependency
installation disabled lifecycle scripts. No UI server or AI service was
started. `git diff --check` passes. Real browser
frame isolation/navigation tests, exploitation against a live page, AI-server
review, Chrome-package comparison, and encrypted-storage design remain outside
the completed audit.
