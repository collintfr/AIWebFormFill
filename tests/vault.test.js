import { describe, expect, it, vi } from 'vitest';
import { Vault, validateEnvelope, validateProfile } from '../src/js/vault.js';
const passphrase = 'synthetic vault passphrase';
function fixture() {
  const data = {};
  const storage = { get: vi.fn(async key => ({ [key]: data[key] })), set: vi.fn(async values => Object.assign(data, values)) };
  return { vault: new Vault(storage), data, storage };
}
describe('Encrypted local vault', () => {
  it('persists no plaintext profile, passphrase or key and uses fresh IVs', async () => {
    const { vault, data } = fixture();
    await vault.create(passphrase);
    await vault.save({ 'Applicant Example': ['fullName'] });
    const first = structuredClone(data.encryptedVault);
    expect(JSON.stringify(data)).not.toContain('Applicant Example');
    expect(JSON.stringify(data)).not.toContain(passphrase);
    expect(vault.key.extractable).toBe(false);
    await vault.save({ 'Applicant Example': ['fullName'] });
    expect(data.encryptedVault.iv).not.toBe(first.iv);
    expect(data.encryptedVault.ciphertext).not.toBe(first.ciphertext);
    vault.lock(); expect(vault.key).toBeNull(); expect(vault.profile).toBeNull();
    await expect(vault.save({})).rejects.toThrow('LOCKED');
    await vault.unlock(passphrase);
    expect(vault.profile).toEqual({ 'Applicant Example': ['fullName'] });
  });
  it('rejects wrong passwords, altered ciphertext and nonce tampering', async () => {
    const { vault, data } = fixture();
    await vault.create(passphrase); vault.lock();
    await expect(vault.unlock('incorrect passphrase')).rejects.toThrow('UNLOCK_FAILED');
    const original = structuredClone(data.encryptedVault);
    data.encryptedVault.ciphertext = (original.ciphertext[0] === 'A' ? 'B' : 'A') + original.ciphertext.slice(1);
    await expect(vault.unlock(passphrase)).rejects.toThrow('UNLOCK_FAILED');
    data.encryptedVault = { ...original, iv: btoa('123456789012') };
    await expect(vault.unlock(passphrase)).rejects.toThrow('UNLOCK_FAILED');
    expect(vault.unlocked).toBe(false);
  });
  it('supports only authenticated encrypted backup replacement and fresh encryption', async () => {
    const original = fixture(); await original.vault.create(passphrase);
    await original.vault.save({ 'Synthetic Email': ['email'] });
    const backup = await original.vault.export();
    const imported = fixture(); await imported.vault.import(backup, passphrase);
    expect(imported.vault.profile).toEqual(original.vault.profile);
    expect(imported.data.encryptedVault.iv).not.toBe(backup.iv);
    await expect(imported.vault.import({ name: 'Applicant Example' }, passphrase)).rejects.toThrow('ENCRYPTED_BACKUP_REQUIRED');
    expect(() => validateEnvelope({ ...backup, iterations: 1 })).toThrow();
  });
  it('preserves the previous vault on failed saves/imports and changes passwords', async () => {
    const { vault, data, storage } = fixture(); await vault.create(passphrase);
    const before = structuredClone(data.encryptedVault);
    storage.set.mockRejectedValueOnce(new Error('disk failure'));
    await expect(vault.save({ 'Applicant Example': ['name'] })).rejects.toThrow();
    expect(data.encryptedVault).toEqual(before); expect(vault.profile).toEqual({});
    await expect(vault.import(before, 'incorrect passphrase')).rejects.toThrow();
    expect(data.encryptedVault).toEqual(before);
    await vault.replace({}, 'a different synthetic passphrase'); vault.lock();
    await expect(vault.unlock(passphrase)).rejects.toThrow();
    await vault.unlock('a different synthetic passphrase'); expect(vault.unlocked).toBe(true);
  });
  it('a lock during key derivation cancels creation and discards key material', async () => {
    const { vault, data } = fixture();
    const creating = vault.create(passphrase);
    vault.lock();
    // create checks existence first; let replace start before interrupting.
    await Promise.resolve(); await Promise.resolve(); vault.lock();
    await expect(creating).rejects.toThrow('SESSION_CHANGED');
    expect(data.encryptedVault).toBeUndefined(); expect(vault.unlocked).toBe(false);
  });
  it('validates profiles without requiring plaintext migration', () => {
    expect(() => validateProfile({ fullName: 'Applicant Example' })).toThrow('INVALID_PROFILE');
    expect(() => validateProfile({ value: ['x'.repeat(257)] })).toThrow();
    const prototypeKey = JSON.parse('{"__proto__":["name"]}');
    expect(validateProfile(prototypeKey)['__proto__']).toEqual(['name']);
  });
});
