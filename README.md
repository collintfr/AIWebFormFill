# AI Form Fill Helper

A Firefox-first browser extension that matches saved values to form fields on
your device and lets you review them before filling. Version 2 replaces automatic
suggestions, synced plaintext profiles, and AI server configuration with an
encrypted local vault and offline Transformers.js embeddings.

See [DESIGN.md](DESIGN.md) for the overall application flow and component boundaries,
[privacy policy](others/privacy.md) for data handling, and
[security audit](SECURITY_AUDIT.md) for the original findings and remediation review.

## Build and load

Use the checked-in Nix environment; shell entry does not install dependencies.

```sh
devenv shell -- npm ci --ignore-scripts
devenv shell -- npm run build
```

In Firefox, open `about:debugging`, choose **This Firefox → Load Temporary Add-on**,
and select `dist/firefox/manifest.json`. Firefox 128 or newer is required. The build
also creates `dist/firefox.zip`, `dist/chrome/`, and `dist/chrome.zip`. Browser-specific
manifests are templates; load the complete generated package, not `src/` or `Firefox/`.
Firefox is the tested target; Chrome packaging is maintained but is not browser-validated.

The build bundles the pinned Transformers.js/ONNX runtime locally. There are no
remotely executed scripts. Model weights are separate, explicitly downloaded assets.

## Use

1. Click the extension icon to open Options. Create an empty vault with a strong
   passphrase of at least 12 characters. There is no password recovery.
2. Enter values and aliases, then save encrypted changes. For example:

   ```json
   {
     "Applicant Example": ["fullName", "name"],
     "applicant@example.test": ["email", "emailAddress"]
   }
   ```

3. Optionally download the local MiniLM model in Options. Public model assets come
   from Hugging Face and its fixed asset hosts, with revision and integrity checks.
   No saved values, aliases, or page metadata are sent in those requests. After
   setup, inference runs offline on CPU/WASM. Exact aliases and manual selection
   work without the model.
4. Approve the destination URL in Options, grant its browser permission, and reload
   the application page. Right-click an empty visible field and choose **Preview
   this field** or **Preview this form**.
5. Prepare the preview, inspect the destination and proposed values, adjust the
   selections, and click **Fill approved values**. Form preview covers the selected
   field's form and frame only. A form-free field gets a single-field preview.
6. For an embedded third-party form, approve that frame's destination separately,
   reload the application, and approve the frame again in the preview.

Focusing a field does nothing automatically. Proposed values stay in the extension
preview until you approve insertion. Once inserted, the destination page and its
scripts can read them. Fields that become populated, hidden, moved, or relabeled
are skipped. Navigation invalidates the document token. Previews expire after two minutes.

The vault stays unlocked in background memory until Lock, browser exit, or
background-context eviction. Chrome service-worker suspension may relock earlier.
No key or passphrase is persisted. Automatic learning defaults off; enable learning
for an individual fill only when you want successful mappings saved. Clipboard
copying is explicit and can leave copies in clipboard history.

## Backups and deletion

Import and export accept only the encrypted vault format. Import authenticates the
backup before replacing the vault. Keep its passphrase safe; an old encrypted backup
continues to need its old passphrase after a passphrase change.

Version 1 plaintext profiles, migration backups, old alias caches, and sync/session
data are automatically erased when the extension background starts. Restored old
data is erased again when storage changes. There is no conversion, import, or
legacy-data control. Enter your profile again in the encrypted vault. If cleanup
fails, vault operations wait for successful cleanup. **Reset editor** reloads saved
data; it does not delete it.
**Clear all personal data** deletes the vault, legacy sync/local profiles, migration
backups, session metadata, preferences, and model caches, then clears active sessions.
Revoking a destination removes its logical approval and cancels pending previews.

Deletion cannot erase earlier exports, clipboard history, another synced device,
captured logs, or browser/profile backups. Encryption protects stored data; an
unlocked or compromised browser can still expose it. Protect the device and passphrase.

## Validation

Run shell invocations sequentially in this checkout:

```sh
devenv shell -- npm test
devenv shell -- npm audit --ignore-scripts
devenv shell -- npm run build
devenv shell -- npm run test:firefox
devenv shell -- npm run test:firefox -- --model
devenv shell -- sh -c 'XDG_CACHE_HOME="$PWD/.devenv/xdg-cache" devenv test'
```

The Firefox smoke test uses a fresh temporary profile and synthetic forms. Its
privileged driver controls only that test profile, grants test permissions, and
invokes the extension's native context menu. `--model` explicitly downloads the
public pinned model into the temporary profile and runs actual local inference.
No UI server or AI service is started. Unit tests cover runtime behavior rather
than asserting vulnerable behavior or obsolete source-code shapes.

To intentionally review and update model asset hashes, use
`devenv shell -- node scripts/pin-model.mjs`; this is never part of installation or
the normal build. Review the model revision, licensing, and generated diff first.
