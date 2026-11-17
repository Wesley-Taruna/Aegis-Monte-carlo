'use strict';
// Statistics helpers.

const Z95 = 1.959963984540054; // two-sided 95% normal quantile

// Wilson score interval for k successes out of n trials.
// Better than the simple "p +/- 1.96*sqrt(p(1-p)/n)" when p is near 0 or 1.
function wilson(k, n, z = Z95) {
  if (n === 0) return { rate: null, low: null, high: null };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  // At k = 0 (or k = n) the exact bound is 0 (or 1); clamp away rounding noise.
  return {
    rate: p,
    low: k === 0 ? 0 : Math.max(0, centre - half),
    high: k === n ? 1 : Math.min(1, centre + half),
  };
}

// Summary of one rate, in the form every results table uses.
// When k = 0, also give the "rule of three" 95% upper bound 3/N.
function summarize(k, n) {
  const w = wilson(k, n);
  return {
    count: k,
    N: n,
    rate: w.rate,
    wilsonLow: w.low,
    wilsonHigh: w.high,
    upper3N: k === 0 && n > 0 ? 3 / n : null,
  };
}

// P(at least one success in n guesses of a b-bit MAC) = 1 - (1 - 2^-b)^n,
// computed with log1p/expm1 so it stays accurate for b = 64.
function guessSuccessProbability(bits, attempts) {
  return -Math.expm1(attempts * Math.log1p(-Math.pow(2, -bits)));
}

module.exports = { wilson, summarize, guessSuccessProbability, Z95 };
