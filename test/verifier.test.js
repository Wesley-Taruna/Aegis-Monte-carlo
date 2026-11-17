'use strict';
// Stage 3: every verifier rule, plus the information boundary.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Tag } = require('../src/sdm');
const { Verifier, toServerView } = require('../src/verifier');

const UID = Buffer.from('04A1B2C3D4E5F6', 'hex');
const KEY = Buffer.alloc(16, 7);

function setup(policy = {}) {
  const tag = new Tag({ uid: UID, key: KEY });
  const verifier = new Verifier(
    { W: 2, T: null, rateLimit: { maxAttempts: 100, windowSeconds: 60 }, macBits: 64, tamperInMac: true, ...policy },
    new Map([[tag.uidHex, KEY]]),
  );
  const send = (msg, time) => verifier.verify(toServerView(msg, time));
  return { tag, verifier, send };
}

test('genuine message is accepted', () => {
  const { tag, send } = setup();
  assert.deepEqual(send(tag.tap(), 0), { outcome: 'accepted', rule: null });
});

test('MAC rule: wrong MAC is rejected', () => {
  const { tag, send } = setup();
  const m = tag.tap();
  assert.equal(send({ ...m, mac: '0000000000000000' }, 0).rule, 'mac');
});

test('MAC rule: changed counter with the old MAC is rejected', () => {
  const { tag, send } = setup();
  const m = tag.tap();
  assert.equal(send({ ...m, counter: m.counter + 5 }, 0).rule, 'mac');
});

test('MAC rule: a clone with the same UID but another key is rejected', () => {
  const { send } = setup();
  const clone = new Tag({ uid: UID, key: Buffer.alloc(16, 9) });
  assert.equal(send(clone.tap(), 0).rule, 'mac');
});

test('unknown UID is rejected', () => {
  const { send } = setup();
  const other = new Tag({ uid: Buffer.from('04000000000001', 'hex'), key: KEY });
  assert.equal(send(other.tap(), 0).rule, 'unknown_uid');
});

test('duplicate rule: exact replay is rejected', () => {
  const { tag, send } = setup();
  const m = tag.tap();
  send(m, 0);
  assert.equal(send(m, 1).rule, 'duplicate');
});

test('forward gaps are allowed (lost uploads)', () => {
  const { tag, send } = setup();
  send(tag.tap(), 0);
  tag.tap(); tag.tap(); tag.tap(); // three lost uploads
  assert.equal(send(tag.tap(), 1).outcome, 'accepted');
});

test('window rule: counter within W behind lastAccepted is accepted once', () => {
  const { tag, send } = setup({ W: 2 });
  const m1 = tag.tap(), m2 = tag.tap(), m3 = tag.tap();
  send(m3, 0);
  assert.equal(send(m2, 1).outcome, 'accepted');
  assert.equal(send(m1, 2).outcome, 'accepted');
  assert.equal(send(m1, 3).rule, 'duplicate');
});

test('window rule: counter more than W behind is rejected', () => {
  const { tag, send } = setup({ W: 1 });
  const m1 = tag.tap(); tag.tap(); const m3 = tag.tap();
  send(m3, 0);
  assert.equal(send(m1, 1).rule, 'window');
});

test('window rule: W = 0 rejects any out-of-order message', () => {
  const { tag, send } = setup({ W: 0 });
  const m1 = tag.tap(), m2 = tag.tap();
  send(m2, 0);
  assert.equal(send(m1, 1).rule, 'window');
});

test('time rule: backward message must arrive within T of the last acceptance (server clock)', () => {
  const { tag, send } = setup({ W: 4, T: 30 });
  const m1 = tag.tap(), m2 = tag.tap(), m3 = tag.tap();
  send(m3, 100);
  assert.equal(send(m2, 120).outcome, 'accepted');   // 20 s after the last acceptance
  assert.equal(send(m1, 151).rule, 'time');          // 31 s after the last acceptance (at 120)
});

test('time rule does not apply to forward counters', () => {
  const { tag, send } = setup({ W: 4, T: 5 });
  send(tag.tap(), 0);
  assert.equal(send(tag.tap(), 1000).outcome, 'accepted');
});

test('rate limit: attempts beyond R per window are rejected, failed MACs count', () => {
  const { tag, send } = setup({ rateLimit: { maxAttempts: 3, windowSeconds: 60 } });
  const m = tag.tap();
  send({ ...m, mac: '0000000000000000' }, 0);
  send({ ...m, mac: '1111111111111111' }, 1);
  send({ ...m, mac: '2222222222222222' }, 2);
  assert.equal(send(m, 3).rule, 'rate_limit');       // the genuine one is now blocked
  assert.equal(send(m, 61).outcome, 'accepted');      // window has passed
});

test('tamper: genuine message with open seal is reported as compromised', () => {
  const { tag, send } = setup();
  tag.openSeal();
  assert.equal(send(tag.tap(), 0).outcome, 'compromised');
});

test('tamper: flipping open -> closed breaks the MAC', () => {
  const { tag, send } = setup();
  tag.openSeal();
  const m = tag.tap();
  assert.equal(send({ ...m, tamperStatus: 'closed' }, 0).rule, 'mac');
});

test('information boundary: verifier refuses ground-truth fields', () => {
  const { tag, verifier } = setup();
  const m = tag.tap();
  for (const field of ['isAttack', 'attackType', 'createdAt', 'source']) {
    assert.throws(() => verifier.verify({ ...toServerView(m, 0), [field]: true }), /non-server field/);
  }
});

test('information boundary: toServerView keeps only server fields', () => {
  const view = toServerView({ uid: 'X', counter: 1, tamperStatus: 'closed', mac: 'AA', isAttack: true, createdAt: 5 }, 9);
  assert.deepEqual(Object.keys(view).sort(), ['counter', 'mac', 'serverReceiveTime', 'tamperStatus', 'uid']);
});
