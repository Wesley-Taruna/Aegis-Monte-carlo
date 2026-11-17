'use strict';
// Simulation engine: runs ONE trial (one tag's story) through the verifier.
//
// Two worlds are kept apart here:
//   * Simulation world: who sent each message, whether it is an attack, when it
//     was created. These labels ("truth") live only in this file and in the
//     metrics.
//   * Server world: the verifier only ever gets toServerView(message, time).
//
// Flow of a trial:
//   1. Make a tag (random UID + key from the seeded RNG) and register its key
//      with a fresh verifier.
//   2. Schedule the physical taps (owner, and attacker for A4/A5) in time order;
//      each tap increments the tag counter.
//   3. Owner messages go through the channel (lost / delayed / reordered).
//      Attacker messages are submitted when the attacker chooses.
//   4. Deliver everything to the verifier in server-arrival order and record
//      each result next to its (hidden) truth label.

const { Tag } = require('./sdm');
const { Verifier, toServerView, isGenuineVerdict } = require('./verifier');
const { ownerSchedule, transmit } = require('./channel');

// Small min-heap of events ordered by arrival time (ties: order of insertion).
class EventQueue {
  constructor() { this.heap = []; this.seq = 0; }
  get size() { return this.heap.length; }
  push(time, event) {
    const node = { time, seq: this.seq++, event };
    const h = this.heap;
    h.push(node);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(h[p], h[i])) break;
      [h[p], h[i]] = [h[i], h[p]];
      i = p;
    }
  }
  pop() {
    const h = this.heap;
    const top = h[0];
    const last = h.pop();
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < h.length && less(h[l], h[m])) m = l;
        if (r < h.length && less(h[r], h[m])) m = r;
        if (m === i) break;
        [h[m], h[i]] = [h[i], h[m]];
        i = m;
      }
    }
    return top;
  }
}
function less(a, b) { return a.time < b.time || (a.time === b.time && a.seq < b.seq); }

// A new tag plus a verifier that knows its key.
function makeWorld(rng, cfg, policy) {
  const uid = rng.bytes(7);
  uid[0] = 0x04; // NXP manufacturer byte, like real UIDs
  const key = rng.bytes(16);
  const macBits = policy.macBits ?? cfg.tag.macBits;
  const tamperInMac = cfg.tag.tamperInMac;
  const tag = new Tag({ uid, key, macBits, tamperInMac });
  const verifier = new Verifier(
    { W: policy.W, T: policy.T, rateLimit: policy.rateLimit, macBits, tamperInMac },
    new Map([[tag.uidHex, key]]),
  );
  return { rng, cfg, tag, verifier, macBits, maxAcceptedOwnerCounter: 0 };
}

/**
 * Run one trial.
 * @param attacker  optional object with hooks (see attackers.js):
 *    setup(world)                         -> called before any tap
 *    plannedTaps(world, ownerTimes)       -> [{ time, ...info }] attacker's own physical taps
 *                                            (world.activityWindows = when the bar is being handled)
 *    onAttackerTap(world, message, tap, queue)  -> attacker got a genuine message
 *    onResult(world, event, result, queue)      -> after each verification
 * @returns log: one entry per delivered message { source, result, ...truth }
 */
function runTrial(rng, cfg, policy, attacker = null) {
  const world = makeWorld(rng, cfg, policy);
  const queue = new EventQueue();
  const log = [];
  const tapRecord = []; // every physical tap, including lost uploads (for the trace view)
  let ownerTaps = 0, ownerLost = 0;

  if (attacker?.setup) attacker.setup(world);

  // Physical taps in time order (counter values are assigned in this order).
  const schedule = ownerSchedule(rng, cfg.owner);
  world.activityWindows = schedule.windows;
  world.ownerTapCount = schedule.times.length;
  const taps = schedule.times.map((time) => ({ time, who: 'owner' }));
  if (attacker?.plannedTaps) {
    for (const t of attacker.plannedTaps(world, taps.map((x) => x.time))) taps.push({ ...t, who: 'attacker' });
    taps.sort((a, b) => a.time - b.time);
  }
  world.ownerEndTime = taps.length ? taps[taps.length - 1].time : 0;

  for (const tap of taps) {
    const message = world.tag.tap();
    if (tap.who === 'owner') {
      ownerTaps++;
      const ch = transmit(rng, cfg.channel);
      tapRecord.push({ time: tap.time, counter: message.counter, who: 'owner', lost: ch.lost });
      if (ch.lost) { ownerLost++; continue; }
      queue.push(tap.time + ch.delay, {
        message,
        truth: { source: 'owner', isAttack: false, createdAt: tap.time, reordered: ch.reordered },
      });
    } else {
      tapRecord.push({ time: tap.time, counter: message.counter, who: 'attacker', lost: false });
      attacker.onAttackerTap(world, message, tap, queue);
    }
  }
  if (attacker?.afterTaps) attacker.afterTaps(world, queue);

  // Deliver to the server in arrival order.
  while (queue.size) {
    const { time, event } = queue.pop();
    if (event.truth.isAttack) {
      // Metrics-layer label: had the owner already got a later counter accepted?
      event.truth.ownerAheadAtArrival = world.maxAcceptedOwnerCounter > event.message.counter;
    }
    const result = world.verifier.verify(toServerView(event.message, time));
    if (event.truth.source === 'owner' && isGenuineVerdict(result)) {
      world.maxAcceptedOwnerCounter = Math.max(world.maxAcceptedOwnerCounter, event.message.counter);
    }
    log.push({ ...event.truth, time, counter: event.message.counter, result });
    if (attacker?.onResult) attacker.onResult(world, event, result, queue, time);
  }
  return { log, taps: tapRecord, ownerTaps, ownerLost };
}

module.exports = { runTrial, makeWorld, EventQueue };
