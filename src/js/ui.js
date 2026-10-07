export const api = globalThis.browser ?? globalThis.chrome;
export const errors = {
  LOCKED: 'Unlock your vault in Options, then open a new preview.',
  PASSPHRASE_LENGTH: 'Use a passphrase between 12 and 1,024 characters.',
  PASSPHRASE_CONFIRMATION: 'The passphrases do not match.',
  UNLOCK_FAILED: 'The passphrase is incorrect or the encrypted vault is damaged.',
  INVALID_PROFILE: 'Invalid structured profile. Use unique IDs, at most 8 record levels, 1,000 attributes, 100 aliases per attribute, and 256 characters per name or alias.',
  SELECT_OPEN_CONTROL: 'Right-click a visible Add/Edit button or link. Submit controls cannot be opened.',
  SUBFORM_NOT_FOUND: 'No new inline or modal fields were detected. Open the form manually and right-click a field for a new preview.',
  ENCRYPTED_BACKUP_REQUIRED: 'Only encrypted AI Form Fill backups are supported.',
  INVALID_BACKUP: 'This encrypted backup has an invalid format.',
  PREVIEW_EXPIRED: 'This preview expired. Right-click the field to open a new one.',
  PERMISSION_REQUIRED: 'Approve this destination and grant its site permission first.',
  FRAME_APPROVAL_REQUIRED: 'Approve the embedded destination for this preview.',
  SELECT_EMPTY_VISIBLE_FIELD: 'Right-click an empty, visible, editable field after approving the site.',
  STALE_DOCUMENT: 'The page changed. Open a new preview.',
  ORIGIN_CHANGED: 'The destination changed. Open a new preview.',
  INVALID_SELECTION: 'The selection is invalid or below the similarity threshold.',
  VAULT_EXISTS: 'A vault already exists. Unlock it instead.',
  SESSION_CHANGED: 'The vault session changed. Try again.',
  STORAGE_CLEANUP_FAILED: 'Old storage could not be erased. Reopen the extension to retry before using the vault.',
  MODEL_INTEGRITY_FAILED: 'The model failed its integrity check. Download it again.',
  MODEL_DOWNLOAD_CANCELLED: 'The download was cancelled.',
  MODEL_DOWNLOAD_FAILED: 'The public model download failed. Check connectivity and retry.',
  MODEL_DOWNLOAD_TIMED_OUT: 'The public model download timed out. Retry when connectivity improves.',
  MODEL_DESTINATION_BLOCKED: 'The model redirected to an unapproved asset host. Download blocked.',
  MODEL_SETUP_REQUIRED: 'Download the model in Options to enable similarity matching.',
  OPERATION_FAILED: 'The operation could not be completed. Reopen the page and try again.'
};
export async function send(action, details = {}) {
  const response = await api.runtime.sendMessage({ action, ...details });
  if (!response?.ok) throw new Error(response?.error ?? 'OPERATION_FAILED');
  return response.value;
}
export function showError(error, element) {
  element.textContent = errors[error.message] ?? 'The operation failed. Check setup, permissions, and vault status, then retry.';
}
export function downloadJson(data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'ai-form-fill.encrypted.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
