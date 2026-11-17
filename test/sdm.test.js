'use strict';
// Stage 2: tag model and AN12196 Rev. 2.0 vectors (Tables 1, 4, 5).
const test = require('node:test');
const assert = require('node:assert/strict');
const { aesCmac } = require('../src/cmac');
const { sessionVector, sessionMacKey, truncateSdm, truncateBits, hex, Tag } = require('../src/sdm');
const { AN12196 } = require('../src/vectors');

for (const v of AN12196) {
  const key = Buffer.from(v.key, 'hex');
  const uid = Buffer.from(v.uid, 'hex');
  test(`${v.name}: SV2`, () => {
    assert.equal(hex(sessionVector(uid, v.counter)), v.sv2);
  });
  test(`${v.name}: session key`, () => {
    assert.equal(hex(sessionMacKey(key, uid, v.counter)), v.sessionKey);
  });
  if (v.sdmMac) {
    test(`${v.name}: SDMMAC`, () => {
      const full = aesCmac(sessionMacKey(key, uid, v.counter), Buffer.from(v.macInput, 'ascii'));
      if (v.fullCmac) assert.equal(hex(full), v.fullCmac);
      assert.equal(hex(truncateSdm(full)), v.sdmMac);
    });
  }
}

test('truncateBits keeps only the first b bits', () => {
  const m = Buffer.from('FFFFFFFFFFFFFFFF', 'hex');
  assert.equal(hex(truncateBits(m, 8)), 'FF');
  assert.equal(hex(truncateBits(m, 12)), 'FFF0');
  assert.equal(hex(truncateBits(m, 64)), 'FFFFFFFFFFFFFFFF');
});

test('every tap increases the counter by one and changes the MAC', () => {
  const tag = new Tag({ uid: Buffer.from('04010203040506', 'hex'), key: Buffer.alloc(16, 1) });
  const a = tag.tap(), b = tag.tap();
  assert.equal(a.counter, 1);
  assert.equal(b.counter, 2);
  assert.notEqual(a.mac, b.mac);
});

test('tamper status changes the MAC when tamperInMac = true', () => {
  const t1 = new Tag({ uid: Buffer.from('04010203040506', 'hex'), key: Buffer.alloc(16, 1), tamperInMac: true });
  const t2 = new Tag({ uid: Buffer.from('04010203040506', 'hex'), key: Buffer.alloc(16, 1), tamperInMac: true });
  t2.openSeal();
  assert.notEqual(t1.tap().mac, t2.tap().mac);
});
