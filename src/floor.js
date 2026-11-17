'use strict';
// Analytical formula for the delayed-relay "floor" (steady scenario).
//
// The floor is the probability that a captured message, submitted D seconds
// after capture, reaches the server BEFORE any newer owner upload has arrived.
// Such a relay carries the newest counter, so every W and T accepts it.
//
// Derivation (plain words):
//   1. Owner taps form a Poisson process with rate lambda = 1 / meanTapGapSeconds.
//      Because a Poisson process is memoryless, the taps after the capture
//      moment are again a Poisson process with the same rate.
//   2. Each later tap's upload is delivered with probability q = 1 - pLoss and
//      arrives after an independent random delay X (base delay, plus the extra
//      reordering delay with probability pReorder).
//   3. A later tap made s seconds after capture has arrived by time D if
//      s + X <= D. Thinning and shifting a Poisson process gives another Poisson
//      process, so the number of newer uploads that have arrived by D is Poisson
//      with mean
//          m(D) = lambda * q * integral_0^D P(X <= D - s) ds = lambda * q * E[(D - X)+]
//   4. The relay is "before" exactly when that number is zero:
//          F(D) = exp( -m(D) ).
//
// Conditions under which this is exact: the owner keeps tapping indefinitely
// (no end of trial), and the rate limit never blocks a newer owner upload.
// A newer owner upload that arrives while lastAccepted < captured counter is a
// forward counter, so it is always accepted - which is why "arrived" equals
// "accepted" in step 4.

// E[(t - B)+] for B uniform on [a, b].
function expectedExcessUniform(t, a, b) {
  if (t <= a) return 0;
  if (t >= b) return t - (a + b) / 2;
  return ((t - a) * (t - a)) / (2 * (b - a));
}

// E[(D - X)+] for the channel's delay model, X = B + R*E.
function expectedExcessDelay(D, channel, steps = 2000) {
  const [a, b] = channel.baseDelaySeconds;
  const [c, d] = channel.reorderExtraDelaySeconds;
  const r = channel.pReorder;
  const notReordered = expectedExcessUniform(D, a, b);
  // Reordered: average E[(D - E - B)+] over E uniform on [c, d] (Simpson's rule).
  let sum = 0;
  const h = (d - c) / steps;
  for (let i = 0; i <= steps; i++) {
    const w = i === 0 || i === steps ? 1 : i % 2 ? 4 : 2;
    sum += w * expectedExcessUniform(D - (c + i * h), a, b);
  }
  const reordered = (sum * h) / 3 / (d - c);
  return (1 - r) * notReordered + r * reordered;
}

// Floor F(D) for the steady scenario.
function floorProbability(D, { owner, channel }) {
  const lambda = 1 / owner.meanTapGapSeconds;
  const q = 1 - channel.pLoss;
  return Math.exp(-lambda * q * expectedExcessDelay(D, channel));
}

module.exports = { floorProbability, expectedExcessDelay, expectedExcessUniform };
