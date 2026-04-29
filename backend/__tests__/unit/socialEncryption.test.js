const crypto = require('crypto');

const KEY_B64 = crypto.randomBytes(32).toString('base64');

describe('socialEncryption', () => {
  let savedKey;

  beforeEach(() => {
    savedKey = process.env.SOCIAL_TOKEN_KEY;
    process.env.SOCIAL_TOKEN_KEY = KEY_B64;
    jest.resetModules();
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.SOCIAL_TOKEN_KEY;
    else process.env.SOCIAL_TOKEN_KEY = savedKey;
  });

  test('roundtrips a token', () => {
    const { encrypt, decrypt } = require('../../utils/socialEncryption');
    const plaintext = 'sk_test_AbcDefGhij_12345.token.string';
    const encrypted = encrypt(plaintext);
    expect(typeof encrypted).toBe('string');
    expect(encrypted).not.toContain(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  test('produces a different ciphertext for the same plaintext (random IV)', () => {
    const { encrypt } = require('../../utils/socialEncryption');
    const a = encrypt('same-plaintext');
    const b = encrypt('same-plaintext');
    expect(a).not.toBe(b);
  });

  test('rejects tampered ciphertext', () => {
    const { encrypt, decrypt } = require('../../utils/socialEncryption');
    const enc = encrypt('original');
    const [iv, tag, ct] = enc.split(':');
    const bad = Buffer.from(ct, 'base64');
    bad[0] = bad[0] ^ 0xff;
    const tampered = `${iv}:${tag}:${bad.toString('base64')}`;
    expect(() => decrypt(tampered)).toThrow();
  });

  test('rejects empty plaintext', () => {
    const { encrypt } = require('../../utils/socialEncryption');
    expect(() => encrypt('')).toThrow();
    expect(() => encrypt(null)).toThrow();
  });

  test('rejects malformed payload on decrypt', () => {
    const { decrypt } = require('../../utils/socialEncryption');
    expect(() => decrypt('not-a-payload')).toThrow();
    expect(() => decrypt('only:two')).toThrow();
  });

  test('throws if SOCIAL_TOKEN_KEY missing', () => {
    delete process.env.SOCIAL_TOKEN_KEY;
    jest.resetModules();
    const { encrypt } = require('../../utils/socialEncryption');
    expect(() => encrypt('anything')).toThrow(/SOCIAL_TOKEN_KEY/);
  });

  test('throws if SOCIAL_TOKEN_KEY is wrong length', () => {
    process.env.SOCIAL_TOKEN_KEY = Buffer.alloc(16).toString('base64');
    jest.resetModules();
    const { encrypt } = require('../../utils/socialEncryption');
    expect(() => encrypt('anything')).toThrow(/32 bytes/);
  });

  test('isConfigured reports correctly', () => {
    const { isConfigured } = require('../../utils/socialEncryption');
    expect(isConfigured()).toBe(true);
    delete process.env.SOCIAL_TOKEN_KEY;
    jest.resetModules();
    const { isConfigured: again } = require('../../utils/socialEncryption');
    expect(again()).toBe(false);
  });
});
