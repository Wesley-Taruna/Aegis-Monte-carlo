'use strict';
// Stage 1: seeded RNG and AES-CMAC (RFC 4493).
const test = require('node:test');
const assert = require('node:assert/strict');
const { aesCmac, subkeysFor } = require('../src/cmac');
const { Rng, rngFor } = require('../src/rng');
const { RFC4493, RFC4493_SUBKEYS } = require('../src/vectors');

test('RFC 4493 subkey generation (L, K1, K2)', () => {
  const sk = subkeysFor(Buffer.from(RFC4493_SUBKEYS.key, 'hex'));
  assert.equal(sk.L.toString('hex'), RFC4493_SUBKEYS.L);
  assert.equal(sk.K1.toString('hex'), RFC4493_SUBKEYS.K1);
  assert.equal(sk.K2.toString('hex'), RFC4493_SUBKEYS.K2);
});

for (const v of RFC4493) {
  test(`RFC 4493 ${v.name}`, () => {
    const got = aesCmac(Buffer.from(v.key, 'hex'), Buffer.from(v.message, 'hex')).toString('hex');
    assert.equal(got, v.cmac);
  });
}

test('RNG: same seed gives the same sequence', () => {
  const a = new Rng(42), b = new Rng(42);
  for (let i = 0; i < 100; i++) assert.equal(a.nextUint32(), b.nextUint32());
});

test('RNG: different labels give different streams', () => {
  assert.notEqual(rngFor(1, 'E1').nextUint32(), rngFor(1, 'E2').nextUint32());
});

test('RNG: uniform values stay in [0, 1) and average about 0.5', () => {
  const r = new Rng(7);
  let sum = 0;
  for (let i = 0; i < 100000; i++) {
    const x = r.next();
    assert.ok(x >= 0 && x < 1);
    sum += x;
  }
  assert.ok(Math.abs(sum / 100000 - 0.5) < 0.01);
});

test('RNG: exponential mean is close to the configured mean', () => {
  const r = new Rng(9);
  let sum = 0;
  for (let i = 0; i < 100000; i++) sum += r.exponential(60);
  assert.ok(Math.abs(sum / 100000 - 60) < 1);
});
