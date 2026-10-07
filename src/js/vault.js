export const VAULT_KEY = 'encryptedVault';
const iterations = 600000;
const aad = new TextEncoder().encode('AIWebFormFill:vault:1');
const encode = bytes => btoa(String.fromCharCode(...bytes));
const decode = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

export function validateProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile) ||
      Object.getPrototypeOf(profile) !== Object.prototype || Object.keys(profile).length > 1000) {
    throw new Error('INVALID_PROFILE');
  }
  for (const [value, aliases] of Object.entries(profile)) {
    if (!value || value.length > 20000 || !Array.isArray(aliases) || aliases.length > 100 ||
        aliases.some(alias => typeof alias !== 'string' || !alias.trim() || alias.length > 256)) {
      throw new Error('INVALID_PROFILE');
    }
  }
  if (JSON.stringify(profile).length > 1000000) throw new Error('INVALID_PROFILE');
  return structuredClone(profile);
}

export function validateEnvelope(envelope) {
  if (!envelope || envelope.format !== 'AIWebFormFill-encrypted' || envelope.version !== 1 ||
      envelope.kdf !== 'PBKDF2-SHA-256' || envelope.iterations !== iterations ||
      envelope.cipher !== 'AES-256-GCM') throw new Error('ENCRYPTED_BACKUP_REQUIRED');
  try {
    if (typeof envelope.salt !== 'string' || typeof envelope.iv !== 'string' ||
        typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length > 6000000 ||
        decode(envelope.salt).length !== 16 || decode(envelope.iv).length !== 12 ||
        decode(envelope.ciphertext).length < 16) throw new Error();
  } catch { throw new Error('INVALID_BACKUP'); }
  return envelope;
}

async function derive(passphrase, salt) {
  if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 1024) {
    throw new Error('PASSPHRASE_LENGTH');
  }
  const bytes = new TextEncoder().encode(passphrase);
  try {
    const material = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { bytes.fill(0); }
}

async function encrypt(profile, key, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new TextEncoder().encode(JSON.stringify(validateProfile(profile)));
  try {
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad }, key, bytes));
    let binary = '';
    for (const byte of ciphertext) binary += String.fromCharCode(byte);
    return { format: 'AIWebFormFill-encrypted', version: 1, kdf: 'PBKDF2-SHA-256',
      iterations, cipher: 'AES-256-GCM', salt: encode(salt), iv: encode(iv), ciphertext: btoa(binary) };
  } finally { bytes.fill(0); }
}

async function decrypt(envelope, key) {
  let bytes;
  try {
    bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(envelope.iv),
      additionalData: aad }, key, decode(envelope.ciphertext)));
    return validateProfile(JSON.parse(new TextDecoder().decode(bytes)));
  } catch { throw new Error('UNLOCK_FAILED'); }
  finally { bytes?.fill(0); }
}

export class Vault {
  constructor(storage) { this.storage = storage; this.epoch = 0; this.lock(); }
  lock() { this.epoch++; this.key = null; this.profile = null; this.salt = null; }
  get unlocked() { return !!this.key; }
  check(epoch) { if (this.epoch !== epoch) throw new Error('SESSION_CHANGED'); }
  async exists() { return !!(await this.storage.get(VAULT_KEY))[VAULT_KEY]; }
  async unlock(passphrase) {
    const epoch = this.epoch;
    const envelope = validateEnvelope((await this.storage.get(VAULT_KEY))[VAULT_KEY]);
    const salt = decode(envelope.salt);
    const key = await derive(passphrase, salt);
    const profile = await decrypt(envelope, key);
    this.check(epoch);
    this.key = key; this.salt = salt; this.profile = profile;
  }
  async create(passphrase) {
    const epoch = this.epoch;
    if (await this.exists()) throw new Error('VAULT_EXISTS');
    this.check(epoch);
    return this.replace({}, passphrase);
  }
  async replace(profile, passphrase) {
    const epoch = this.epoch;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await derive(passphrase, salt);
    const envelope = await encrypt(profile, key, salt);
    await decrypt(envelope, key);
    this.check(epoch);
    await this.storage.set({ [VAULT_KEY]: envelope });
    this.check(epoch);
    this.key = key; this.salt = salt; this.profile = validateProfile(profile);
  }
  async save(profile) {
    if (!this.unlocked) throw new Error('LOCKED');
    const epoch = this.epoch;
    const clean = validateProfile(profile);
    const envelope = await encrypt(clean, this.key, this.salt);
    this.check(epoch);
    await this.storage.set({ [VAULT_KEY]: envelope });
    this.check(epoch);
    this.profile = clean;
  }
  async import(envelope, passphrase) {
    const epoch = this.epoch;
    validateEnvelope(envelope);
    const key = await derive(passphrase, decode(envelope.salt));
    const profile = await decrypt(envelope, key);
    this.check(epoch);
    await this.replace(profile, passphrase);
  }
  async export() {
    if (!this.unlocked) throw new Error('LOCKED');
    return validateEnvelope((await this.storage.get(VAULT_KEY))[VAULT_KEY]);
  }
}
