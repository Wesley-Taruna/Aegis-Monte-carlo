'use strict';
// The five attackers. Each is a set of hooks used by simulate.js.
//
// What attackers know: the UID and anything public (messages they saw, the
// rough current counter). What they never know: the tag key.
// No attack is hard-coded to fail: every attack message goes through the same
// verifier as honest ones, and only the MAC and counter rules decide.

const { Tag } = require('./sdm');
const { randomActivityTime } = require('./channel');

// Random MAC of `bits` bits, as hex (same format a real message uses).
function randomMacHex(rng, bits) {
  const bytes = rng.bytes(Math.ceil(bits / 8));
  const spare = bytes.length * 8 - bits;
  if (spare > 0) bytes[bytes.length - 1] &= (0xff << spare) & 0xff;
  return bytes.toString('hex').toUpperCase();
}

function attackEvent(message, attackType, createdAt, extra = {}) {
  return { message, truth: { source: 'attack', isAttack: true, attackType, createdAt, ...extra } };
}

// A1 Clone: a different chip programmed with the same UID but a key the
// attacker made up. It produces fresh counters; the MAC is computed honestly
// with the wrong key.
function cloneAttacker() {
  return {
    plannedTaps(world) {
      this.submitTime = randomActivityTime(world.rng, world.activityWindows);
      this.cloneKey = world.rng.bytes(16);
      return [];
    },
    afterTaps(world, queue) {
      const clone = new Tag({ uid: world.tag.uid, key: this.cloneKey, ...world.tag.macParams });
      // Attacker picks a fresh-looking counter: a bit above anything public.
      clone.counter = world.tag.counter;
      const message = clone.tap();
      queue.push(this.submitTime, attackEvent(message, 'A1', this.submitTime));
    },
  };
}

// A2 Replay: wait until some owner message is accepted, then resubmit exactly
// that message later.
function replayAttacker(cfg) {
  const [dMin, dMax] = cfg.attackers.A2.replayDelaySeconds;
  return {
    setup(world) {
      // Which owner tap to target, as a fraction of all owner taps (the count is
      // known once the schedule is drawn).
      this.targetFraction = world.rng.next();
      this.done = false;
    },
    onResult(world, event, result, queue, time) {
      if (this.done || event.truth.source !== 'owner') return;
      this.targetCounter ??= 1 + Math.floor(this.targetFraction * world.ownerTapCount);
      if (result.outcome !== 'accepted' || event.message.counter < this.targetCounter) return;
      this.done = true;
      const at = time + world.rng.uniform(dMin, dMax);
      queue.push(at, attackEvent({ ...event.message }, 'A2', at));
    },
  };
}

// A3 MAC guessing: chosen counter, random MAC, up to n attempts. Attempts are
// spaced just over windowSeconds / maxAttempts apart, so a patient attacker is
// never blocked by the rate limit. Stops after the first success.
function guessingAttacker({ attempts, startTime = 0 }) {
  return {
    plannedTaps() { return []; },
    afterTaps(world, queue) {
      const rl = world.verifier.rateLimit;
      this.spacing = rl ? (rl.windowSeconds / rl.maxAttempts) * 1.001 : 1;
      this.sent = 0;
      this.success = false;
      this.counter = world.tag.counter + 1; // fresh counter
      this.send(world, queue, startTime);
    },
    send(world, queue, at) {
      const message = { uid: world.tag.uidHex, counter: this.counter, tamperStatus: 'closed', mac: randomMacHex(world.rng, world.macBits) };
      this.sent++;
      queue.push(at, attackEvent(message, 'A3', at, { attempt: this.sent }));
    },
    onResult(world, event, result, queue, time) {
      if (!event.truth.isAttack) return;
      if (result.outcome === 'accepted' || result.outcome === 'compromised') { this.success = true; return; }
      if (this.sent < attempts) this.send(world, queue, time + this.spacing);
    },
  };
}

// A4 Delayed relay: attacker taps the genuine tag at a random moment while the
// bar is being handled (or, equivalently for the server, intercepts an upload
// that never arrives), keeps the valid message, submits it D seconds later.
function delayedRelayAttacker({ delaySeconds }) {
  return {
    plannedTaps(world) {
      return [{ time: randomActivityTime(world.rng, world.activityWindows) }];
    },
    onAttackerTap(world, message, tap, queue) {
      const at = tap.time + delaySeconds;
      queue.push(at, attackEvent(message, 'A4', tap.time, { delay: delaySeconds }));
    },
  };
}

// A5 Tamper-flag forgery: the seal is open. The attacker taps (a genuine
// "open" message), flips the status to "closed", and submits with either the
// unchanged MAC or a random guessed MAC.
function tamperForgeryAttacker({ variant }) {
  return {
    setup(world) { world.tag.openSeal(); },
    plannedTaps(world) {
      return [{ time: randomActivityTime(world.rng, world.activityWindows) }];
    },
    onAttackerTap(world, message, tap, queue) {
      const forged = { ...message, tamperStatus: 'closed' };
      if (variant === 'guessed_mac') forged.mac = randomMacHex(world.rng, world.macBits);
      const at = tap.time + 1;
      queue.push(at, attackEvent(forged, 'A5', tap.time, { variant }));
    },
  };
}

module.exports = {
  randomMacHex,
  cloneAttacker,
  replayAttacker,
  guessingAttacker,
  delayedRelayAttacker,
  tamperForgeryAttacker,
};
