'use strict';
// Owner behaviour and channel model for honest uploads (phone -> server).
// Every number here comes from config (owner / scenarios / channel), and all of
// them are ASSUMPTIONS, not measurements.

const DAY = 86400;

// When does the owner tap? Two scenarios (config owner.model):
//
//   "steady" - one owner tapping again and again; gaps between taps are
//              exponential with mean meanTapGapSeconds (the 60-second comparison
//              scenario).
//   "gold"   - taps come in bursts during a sale (seller and buyer each check the
//              bar within a few minutes), separated by long quiet periods of days
//              to weeks while the bar sits in a vault.
//
// Returns { times, windows }:
//   times   - tap times in seconds from the start of the trial, increasing
//   windows - [start, end] periods in which someone is handling the bar; attackers
//             who need physical access (A1, A4, A5) act at a random moment inside them.
function ownerSchedule(rng, owner) {
  if ((owner.model ?? 'steady') === 'gold') return goldSchedule(rng, owner);
  const times = [];
  let t = 0;
  for (let i = 0; i < owner.tapsPerTrial; i++) {
    t += rng.exponential(owner.meanTapGapSeconds);
    times.push(t);
  }
  const end = times.length ? times[times.length - 1] : 1;
  return { times, windows: [[0, end]] };
}

function goldSchedule(rng, owner) {
  const [minTaps, maxTaps] = owner.tapsPerSale;
  const [minQuiet, maxQuiet] = owner.quietGapDays;
  const times = [];
  const windows = [];
  let t = 0;
  for (let s = 0; s < owner.salesPerTrial; s++) {
    // Quiet period before this sale (the bar is stored), then the sale itself.
    t += s === 0 ? rng.exponential(owner.meanGapWithinSaleSeconds) : rng.uniform(minQuiet, maxQuiet) * DAY;
    const taps = minTaps + rng.int(maxTaps - minTaps + 1);
    const start = t;
    for (let k = 0; k < taps; k++) {
      if (k > 0) t += rng.exponential(owner.meanGapWithinSaleSeconds);
      times.push(t);
    }
    // The bar stays on the counter a little while after the last check.
    windows.push([start, t + owner.captureTailSeconds]);
  }
  return { times, windows };
}

// Backwards-compatible helper: just the tap times.
function ownerTapTimes(rng, owner) {
  return ownerSchedule(rng, owner).times;
}

// What happens to one upload: lost, or delivered after some delay.
function transmit(rng, channel) {
  if (rng.bernoulli(channel.pLoss)) return { lost: true, delay: null, reordered: false };
  const [bMin, bMax] = channel.baseDelaySeconds;
  let delay = rng.uniform(bMin, bMax);
  const reordered = rng.bernoulli(channel.pReorder);
  if (reordered) {
    const [eMin, eMax] = channel.reorderExtraDelaySeconds;
    delay += rng.uniform(eMin, eMax);
  }
  return { lost: false, delay, reordered };
}

// A uniformly random moment inside the activity windows (weighted by length).
// With a single window [0, end] this is exactly rng.uniform(0, end).
function randomActivityTime(rng, windows) {
  const total = windows.reduce((s, [a, b]) => s + (b - a), 0);
  let u = rng.uniform(0, total);
  for (const [a, b] of windows) {
    if (u <= b - a) return a + u;
    u -= b - a;
  }
  return windows[windows.length - 1][1];
}

module.exports = { ownerSchedule, ownerTapTimes, transmit, randomActivityTime, DAY };
