'use strict';
// Server verification policy - THE THING BEING EVALUATED.
//
// The most important rule of this project: the verifier only sees what a real
// server would receive. It is given exactly these fields per message:
//     { uid, counter, tamperStatus, mac, serverReceiveTime }
// plus its own stored per-tag state and the tag keys in its key store.
// Simulation labels (isAttack, attackType, createdAt, ...) never reach it:
// verify() throws if any other field is present.
//
// Checks, in this order (the first failing one is recorded as the reason):
//   1. unknown_uid  - UID not in the key store (cannot verify at all)
//   2. rate_limit   - more than R attempts for this tag in the last `windowSeconds`
//   3. mac          - MAC wrong for this UID, counter and tamper status
//   4. duplicate    - this exact counter was already accepted (replay)
//   5. window       - counter older than lastAccepted - W
//   6. time         - (optional rule T) a backward-window counter arrived more
//                     than T seconds after the server's last acceptance
// If all pass: outcome "accepted", or "compromised" if the (MAC-valid) tamper
// status says "open" - a genuine tag whose seal is broken.

const crypto = require('node:crypto');
const { createCmac } = require('./cmac');
const { computeMessageMac } = require('./sdm');

const SERVER_FIELDS = ['uid', 'counter', 'tamperStatus', 'mac', 'serverReceiveTime'];

// Build the object a real server would get. The simulation layer must call
// this; it is the only bridge from "simulation world" to "server world".
function toServerView(message, serverReceiveTime) {
  return {
    uid: message.uid,
    counter: message.counter,
    tamperStatus: message.tamperStatus,
    mac: message.mac,
    serverReceiveTime,
  };
}

class Verifier {
  /**
   * @param {object} policy  { W, T (seconds or null = off), rateLimit: { maxAttempts, windowSeconds },
   *                           macBits, tamperInMac }
   * @param {Map<string, Buffer>} keyStore  UID hex -> 16-byte tag key
   */
  constructor(policy, keyStore) {
    this.W = policy.W;
    this.T = policy.T ?? null;
    this.rateLimit = policy.rateLimit ?? null;
    this.macParams = { macBits: policy.macBits, tamperInMac: policy.tamperInMac };
    this.keys = new Map();
    for (const [uidHex, key] of keyStore) {
      this.keys.set(uidHex, { uid: Buffer.from(uidHex, 'hex'), cmac: createCmac(key) });
    }
    this.state = new Map(); // UID hex -> per-tag state
    // Performance cache only: the expected MAC depends only on (uid, counter,
    // tamper status), so a real server could cache it too. It changes nothing
    // about which messages are accepted.
    this.macCache = new Map();
  }

  tagState(uidHex) {
    let s = this.state.get(uidHex);
    if (!s) {
      s = {
        lastAccepted: 0,      // highest accepted counter (tags start at 0, first tap is 1)
        accepted: new Set(),  // recently accepted counters (>= lastAccepted - W)
        lastAcceptTime: null, // server clock time of the last acceptance
        attempts: [],         // server times of recent attempts (rate limit record)
      };
      this.state.set(uidHex, s);
    }
    return s;
  }

  expectedMac(entry, uidHex, counter, tamperStatus) {
    const cacheKey = `${uidHex}:${counter}:${tamperStatus}`;
    let mac = this.macCache.get(cacheKey);
    if (mac === undefined) {
      mac = computeMessageMac(entry.cmac, entry.uid, counter, tamperStatus, this.macParams);
      if (this.macCache.size > 4096) this.macCache.clear();
      this.macCache.set(cacheKey, mac);
    }
    return mac;
  }

  verify(serverMessage) {
    // Enforce the information boundary structurally.
    for (const k of Object.keys(serverMessage)) {
      if (!SERVER_FIELDS.includes(k)) {
        throw new Error(`Verifier received a non-server field "${k}" - ground truth must not reach the verifier`);
      }
    }
    const { uid, counter, tamperStatus, mac, serverReceiveTime } = serverMessage;
    const reject = (rule) => ({ outcome: 'rejected', rule });

    // 1. Key lookup.
    const entry = this.keys.get(uid);
    if (!entry) return reject('unknown_uid');
    const s = this.tagState(uid);

    // 2. Rate limit: at most maxAttempts attempts in any `windowSeconds` span.
    //    Every attempt that passes this gate counts, including ones that later
    //    fail the MAC check. Attempts blocked here are not counted (so a
    //    blocked attacker cannot lock the tag forever).
    if (this.rateLimit) {
      const cutoff = serverReceiveTime - this.rateLimit.windowSeconds;
      while (s.attempts.length && s.attempts[0] <= cutoff) s.attempts.shift();
      if (s.attempts.length >= this.rateLimit.maxAttempts) return reject('rate_limit');
      s.attempts.push(serverReceiveTime);
    }

    // 3. MAC check (constant-time comparison).
    if (!Number.isInteger(counter) || counter < 0 || typeof mac !== 'string') return reject('mac');
    const expected = this.expectedMac(entry, uid, counter, tamperStatus);
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(mac, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return reject('mac');

    // 4. Exact replay of an accepted counter.
    if (s.accepted.has(counter)) return reject('duplicate');

    // 5. Counter rule with backward window W. Forward gaps are always allowed
    //    (lost uploads create gaps).
    const backward = counter < s.lastAccepted;
    if (backward && counter < s.lastAccepted - this.W) return reject('window');

    // 6. Optional time rule, on the SERVER's clock only.
    if (backward && this.T !== null) {
      if (s.lastAcceptTime === null || serverReceiveTime - s.lastAcceptTime > this.T) return reject('time');
    }

    // Accept: update stored state.
    s.accepted.add(counter);
    if (counter > s.lastAccepted) {
      s.lastAccepted = counter;
      for (const c of s.accepted) if (c < s.lastAccepted - this.W) s.accepted.delete(c);
    }
    s.lastAcceptTime = serverReceiveTime;
    return { outcome: tamperStatus === 'open' ? 'compromised' : 'accepted', rule: null };
  }
}

// "Did the server treat this as a genuine tag?" (accepted or compromised).
function isGenuineVerdict(result) {
  return result.outcome === 'accepted' || result.outcome === 'compromised';
}

module.exports = { Verifier, toServerView, isGenuineVerdict, SERVER_FIELDS };
