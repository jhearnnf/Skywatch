// AES-256-GCM helpers for encrypting OAuth tokens at rest in MongoDB.
// SOCIAL_TOKEN_KEY must be a 32-byte key in base64 (generate with:
// openssl rand -base64 32). If unset, encryption throws — refusing to silently
// store plaintext tokens for a third-party OAuth account.

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey() {
  const raw = process.env.SOCIAL_TOKEN_KEY;
  if (!raw) {
    throw new Error('SOCIAL_TOKEN_KEY is not configured — refusing to encrypt/decrypt social account tokens');
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error(`SOCIAL_TOKEN_KEY must decode to 32 bytes (got ${buf.length})`);
  }
  return buf;
}

function encrypt(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('encrypt requires a non-empty string');
  }
  const key = getKey();
  const iv  = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv) + ":" + base64(tag) + ":" + base64(ciphertext)
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decrypt(payload) {
  if (typeof payload !== 'string' || !payload.includes(':')) {
    throw new Error('decrypt requires a colon-delimited payload');
  }
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('decrypt payload must have exactly 3 parts (iv:tag:ciphertext)');
  }
  const [ivB64, tagB64, encB64] = parts;
  const iv  = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const enc = Buffer.from(encB64, 'base64');
  if (iv.length !== IV_LEN)   throw new Error(`iv must be ${IV_LEN} bytes`);
  if (tag.length !== TAG_LEN) throw new Error(`auth tag must be ${TAG_LEN} bytes`);

  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}

function isConfigured() {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

module.exports = { encrypt, decrypt, isConfigured };
