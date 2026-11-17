'use strict';
// Stage 4 demo: one honest tap and one fake tap, explained in plain words.
//   node src/demo.js

const { rngFor } = require('./rng');
const { Tag, hex } = require('./sdm');
const { Verifier, toServerView } = require('./verifier');

function explain(result) {
  if (result.outcome === 'accepted') return 'ACCEPTED - genuine tag, seal closed.';
  if (result.outcome === 'compromised') return 'COMPROMISED - genuine tag, but the seal is open.';
  const why = {
    mac: 'the MAC does not match what the real key would produce',
    duplicate: 'this exact counter was already accepted (replay)',
    window: 'the counter is too far behind the newest accepted one',
    time: 'it is an older counter and arrived too long after the last acceptance',
    rate_limit: 'too many attempts for this tag in a short time',
    unknown_uid: 'the server has no key for this UID',
  }[result.rule];
  return `REJECTED by rule "${result.rule}" - ${why}.`;
}

function runDemo(cfg) {
  const rng = rngFor(cfg.seed, 'demo');
  const uid = rng.bytes(7); uid[0] = 0x04;
  const key = rng.bytes(16);
  const params = { macBits: cfg.tag.macBits, tamperInMac: cfg.tag.tamperInMac };
  const tag = new Tag({ uid, key, ...params });
  const verifier = new Verifier({ W: cfg.verifier.W, T: cfg.verifier.T, rateLimit: cfg.verifier.rateLimit, ...params },
    new Map([[tag.uidHex, key]]));

  const steps = [];
  steps.push({
    title: 'Setup',
    lines: [
      `A gold bar has an NFC tag with UID ${tag.uidHex}.`,
      `The tag and the server share a secret AES-128 key (${hex(key).slice(0, 8)}... - generated from the seed, simulation only).`,
      `Server policy: backward window W = ${cfg.verifier.W}, time rule T = ${cfg.verifier.T ?? 'off'} s, rate limit ${cfg.verifier.rateLimit.maxAttempts} per ${cfg.verifier.rateLimit.windowSeconds} s.`,
    ],
  });

  // 1. Honest tap.
  const honest = tag.tap();
  const r1 = verifier.verify(toServerView(honest, 10));
  steps.push({
    title: '1. Honest tap',
    message: honest,
    lines: [
      `The owner taps the tag. The counter goes up to ${honest.counter}.`,
      `The tag builds a session key from its secret key + UID + counter, and stamps the message with MAC ${honest.mac}.`,
      'The phone uploads it; the server receives only UID, counter, tamper status, MAC and its own arrival time.',
      `The server recomputes the MAC with its copy of the key and checks the counter: ${explain(r1)}`,
    ],
    result: r1,
  });

  // 2. Fake tap: a clone with the same UID but a guessed key.
  const clone = new Tag({ uid, key: rng.bytes(16), ...params });
  clone.counter = tag.counter;
  const fake = clone.tap();
  const r2 = verifier.verify(toServerView(fake, 20));
  steps.push({
    title: '2. Fake tap (clone)',
    message: fake,
    lines: [
      `A counterfeiter copies the UID ${fake.uid} onto a fake tag, but does not know the secret key.`,
      `The fake tag sends counter ${fake.counter} (newer than anything the server saw) with MAC ${fake.mac}.`,
      `The server computes what the MAC should be with the real key: ${explain(r2)}`,
    ],
    result: r2,
  });

  // 3. Replay of the honest message.
  const r3 = verifier.verify(toServerView(honest, 30));
  steps.push({
    title: '3. Replay of the honest message',
    message: honest,
    lines: [
      'Someone copies the URL from step 1 and submits it again.',
      `The MAC is genuine, but: ${explain(r3)}`,
    ],
    result: r3,
  });

  return steps;
}

if (require.main === module) {
  const cfg = require('../config/default.json');
  for (const s of runDemo(cfg)) {
    console.log(`\n== ${s.title} ==`);
    for (const l of s.lines) console.log('  ' + l);
  }
}

module.exports = { runDemo, explain };
