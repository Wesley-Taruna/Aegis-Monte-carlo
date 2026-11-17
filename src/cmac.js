'use strict';
// AES-CMAC, implemented from NIST SP 800-38B / RFC 4493.
//
// CMAC is a "keyed checksum": given a secret 16-byte key and a message, it
// produces a 16-byte tag. Without the key you cannot compute the right tag.
// Node.js has AES but not CMAC, so we build CMAC on top of AES-128-ECB from
// the built-in `crypto` module (ECB = encrypt one 16-byte block at a time).

const crypto = require('node:crypto');

const BLOCK = 16;
const ZERO_BLOCK = Buffer.alloc(BLOCK);
const RB = 0x87; // constant from RFC 4493, section 2.3

// Returns a function that AES-encrypts one 16-byte block with `key`.
// ECB mode has no chaining state, so one cipher object can be reused for many
// blocks as long as we always feed it exactly 16 bytes.
function aesBlockEncryptor(key) {
  if (key.length !== 16) throw new Error('AES-128 key must be 16 bytes');
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
  cipher.setAutoPadding(false);
  return (block) => cipher.update(block);
}

// Shift a 16-byte buffer left by one bit (RFC 4493 "<<").
function shiftLeftOne(buf) {
  const out = Buffer.alloc(BLOCK);
  let carry = 0;
  for (let i = BLOCK - 1; i >= 0; i--) {
    out[i] = ((buf[i] << 1) | carry) & 0xff;
    carry = buf[i] >>> 7;
  }
  return out;
}

// RFC 4493 section 2.3: derive the two subkeys K1, K2 from the key.
function generateSubkeys(encrypt) {
  const L = encrypt(ZERO_BLOCK);
  const K1 = shiftLeftOne(L);
  if (L[0] & 0x80) K1[BLOCK - 1] ^= RB;
  const K2 = shiftLeftOne(K1);
  if (K1[0] & 0x80) K2[BLOCK - 1] ^= RB;
  return { K1, K2 };
}

function xorInto(target, a, b) {
  for (let i = 0; i < BLOCK; i++) target[i] = a[i] ^ b[i];
  return target;
}

// A reusable CMAC calculator for one key (saves re-deriving subkeys each time).
function createCmac(key) {
  const encrypt = aesBlockEncryptor(key);
  const { K1, K2 } = generateSubkeys(encrypt);

  return function cmac(message) {
    // RFC 4493 section 2.4, step by step.
    const n = Math.max(1, Math.ceil(message.length / BLOCK));
    const lastIsComplete = message.length > 0 && message.length % BLOCK === 0;

    // Prepare the last block: XOR with K1 if complete, else pad with 10..0 and XOR with K2.
    const last = Buffer.alloc(BLOCK);
    const lastStart = (n - 1) * BLOCK;
    if (lastIsComplete) {
      xorInto(last, message.subarray(lastStart, lastStart + BLOCK), K1);
    } else {
      const tail = message.subarray(lastStart);
      const padded = Buffer.alloc(BLOCK);
      tail.copy(padded);
      padded[tail.length] = 0x80;
      xorInto(last, padded, K2);
    }

    // CBC-style chaining over all blocks.
    let X = Buffer.alloc(BLOCK);
    const Y = Buffer.alloc(BLOCK);
    for (let i = 0; i < n - 1; i++) {
      xorInto(Y, X, message.subarray(i * BLOCK, (i + 1) * BLOCK));
      X = encrypt(Y);
    }
    xorInto(Y, X, last);
    return Buffer.from(encrypt(Y));
  };
}

// One-shot helper: AES-CMAC(key, message) -> 16-byte Buffer.
function aesCmac(key, message) {
  return createCmac(key)(message);
}

// Exposed for the RFC 4493 subkey test.
function subkeysFor(key) {
  const encrypt = aesBlockEncryptor(key);
  return { L: Buffer.from(encrypt(ZERO_BLOCK)), ...generateSubkeys(encrypt) };
}

module.exports = { aesCmac, createCmac, subkeysFor };
