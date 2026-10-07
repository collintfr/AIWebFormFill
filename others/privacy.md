# Privacy policy — version 2

AI Form Fill Helper stores your profile in an encrypted local vault and performs
field matching on your device. It has no analytics or configured AI inference server.

**Stored information.** Group and record names, nested records, attribute identities,
values, and their field-name aliases are encrypted together
with AES-256-GCM. A passphrase-derived key uses PBKDF2-SHA-256 with 600,000 iterations
and a random salt; each write uses a fresh IV. The extension never stores the
passphrase or key and never writes profiles to browser sync. Approved destination
origins and the matching threshold are plaintext local preferences. Public model
files are cached separately. This does not encrypt browser storage generally or
protect against compromise of an unlocked browser.

**Unlocked sessions.** Decrypted values and keys exist in extension background
memory. Preview and editing pages may also hold private values while open. Matching
workers hold attribute names/aliases, opaque candidate IDs, and selected page metadata
in memory, without saved values or record display names. Locking, browser exit,
or background eviction ends the vault session; extension pages clear their state
when notified or when they detect the ended session. JavaScript cannot guarantee
forensic zeroization of memory. There is no password recovery.

**Page access and filling.** Access is granted for chosen sites rather than all
websites automatically. The browser's host permission may cover more ports than
the exact origin; the extension separately checks its exact-origin approval.
Content scripts capture the selected field, then collect limited metadata only
after an explicit preview command. Supported metadata is name, ID, autocomplete,
associated label, and accessibility label. Group/section labels, control types,
and bounded native dropdown option values and labels are also collected for previews.
Opening previews collect the selected Add/Edit control label. Arbitrary attributes,
HTML, and populated field values are excluded. Labels and aliases can themselves contain private information;
they are processed locally. Embedded third-party destinations need their own
permission and approval for each preview.

No focus-triggered automatic proposals exist. Proposed values appear only in an
extension-owned preview. Clicking Fill approves disclosure to the specified
destination. Once inserted, the website and its first-party or third-party scripts
can read the values, even before submission. Copy is a separate explicit operation;
the OS clipboard and clipboard history may retain that value. Learning is an
explicit per-fill choice and saves successful field aliases back into the vault.

Inline/modal subform opening is a separate explicit approval that clicks one selected
Add/Edit control. No profile values are sent for opening. Page handlers control the
effects of the approved click. Discovery observes newly eligible fields in the
selected document/frame for at most ten seconds and disconnects afterward or on
cancellation. Filling needs fresh approval; the extension never saves or submits
subforms or opens a sequence automatically. Record assignments and combinations
exist only in the current extension preview and are not persisted as page hints.

**Network activity.** An explicit setup download retrieves fixed public model files
from Hugging Face and allowlisted asset hosts. Those servers receive ordinary
download information such as your IP address; requests omit credentials and
referrers and contain no profile, aliases, or page metadata. Files are revision-pinned
and integrity-checked. JavaScript/WASM runtime files are packaged with the extension.
Inference never falls back to remote models or services. Ordinary browser traffic,
extension distribution/update services, and destination websites have their own policies.

**Backups.** Only encrypted vault backups are supported. Import verifies the
passphrase and authenticated contents before replacing the current vault. Plaintext
imports and exports are rejected. Encrypted backup files may be retained by your
downloads directory, file backups, or other software outside the extension.
Authenticated encrypted flat profiles convert in memory into structured records;
unlocking does not rewrite storage. An explicit save or authenticated backup
replacement stores the structured profile in the existing encryption format.

**Deletion and upgrades.** Legacy version 1 plaintext profiles and migration backups
are automatically erased at every background startup, together with old alias
caches, settings, and sync/session storage. Restored old data triggers automatic
cleanup again. There is no conversion or manual legacy-data feature. Cleanup
preserves the encrypted vault and its preferences and public model cache; vault
operations are blocked until cleanup succeeds. Clear all personal data removes extension local/sync/session storage,
model caches, preferences, and active decrypted state. Reset editor does not delete
persisted data. These are logical deletion actions, not guarantees of forensic
disk erasure. They cannot erase previous exports, clipboard history, captured logs,
other synced-device copies, or existing browser/profile backups.

**Diagnostics.** Extension diagnostics use fixed action/error codes rather than
profile values, DOM objects, aliases, endpoint URLs, or request/response bodies.
No diagnostic upload is implemented. Review [DESIGN.md](../DESIGN.md) and the
[security audit](../SECURITY_AUDIT.md) for the implementation boundaries and limitations.
