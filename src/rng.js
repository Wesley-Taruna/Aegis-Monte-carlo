'use strict';
// Seeded random number generator (mulberry32).
//
// Why not Math.random()? Math.random() gives different numbers every run, so
// results could never be reproduced. A seeded generator always produces the
// same sequence for the same seed, so anyone can re-run the paper's numbers.
//
// mulberry32 is a small, well-known 32-bit generator. It is NOT
// cryptographically secure, which is fine: it only drives the simulation
// (tap times, losses, attacker guesses), never real keys for real tags.

// Turns a text label into a 32-bit number (FNV-1a hash). Used to give every
// experiment its own independent random stream derived from the one global
// seed, so adding a new experiment does not shift the numbers of the others.
function hashLabel(label) {
  let h = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

class Rng {
  constructor(seed) {
    if (!Number.isInteger(seed)) throw new Error('Rng seed must be an integer');
    this.state = seed >>> 0;
  }

  // Next 32-bit unsigned integer (the core mulberry32 step).
  nextUint32() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  // Uniform number in [0, 1).
  next() {
    return this.nextUint32() / 4294967296;
  }

  // Uniform number in [a, b).
  uniform(a, b) {
    return a + (b - a) * this.next();
  }

  // Uniform integer in [0, n).
  int(n) {
    return Math.floor(this.next() * n);
  }

  // True with probability p.
  bernoulli(p) {
    return this.next() < p;
  }

  // Exponentially distributed number with the given mean (used for the gaps
  // between an owner's taps: a "memoryless" random waiting time).
  exponential(mean) {
    // 1 - next() is in (0, 1], so the log is always finite.
    return -mean * Math.log(1 - this.next());
  }

  // n random bytes as a Buffer.
  bytes(n) {
    const out = Buffer.alloc(n);
    for (let i = 0; i < n; i += 4) {
      const v = this.nextUint32();
      for (let j = 0; j < 4 && i + j < n; j++) out[i + j] = (v >>> (8 * j)) & 0xff;
    }
    return out;
  }

  // A new, independent generator for a named sub-task (e.g. "E2/W=4/T=30").
  fork(label) {
    return new Rng((this.state ^ hashLabel(label)) >>> 0);
  }
}

// Convenience: build a generator for an experiment from the global seed.
function rngFor(seed, label) {
  return new Rng((seed ^ hashLabel(label)) >>> 0);
}

module.exports = { Rng, rngFor, hashLabel };
