/**
 * Tests for token encryption/decryption roundtrip.
 */
process.env.ENCRYPTION_KEY = 'a'.repeat(64) // 32-byte test key

import { encrypt, decrypt } from '../lib/crypto'

describe('crypto', () => {
  it('encrypts and decrypts a string correctly', () => {
    const plaintext = 'my-secret-refresh-token'
    const ciphertext = encrypt(plaintext)
    expect(ciphertext).not.toBe(plaintext)
    expect(ciphertext.split(':')).toHaveLength(3)
    expect(decrypt(ciphertext)).toBe(plaintext)
  })

  it('produces different ciphertext each call (random IV)', () => {
    const plaintext = 'same-input'
    const c1 = encrypt(plaintext)
    const c2 = encrypt(plaintext)
    expect(c1).not.toBe(c2)
    expect(decrypt(c1)).toBe(plaintext)
    expect(decrypt(c2)).toBe(plaintext)
  })

  it('throws on tampered ciphertext', () => {
    const enc = encrypt('hello')
    const [iv, tag, ct] = enc.split(':')
    const tampered = `${iv}:${tag}:${ct.slice(0, -4)}dead`
    expect(() => decrypt(tampered)).toThrow()
  })
})
