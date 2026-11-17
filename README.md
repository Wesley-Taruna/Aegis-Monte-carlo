# Aegis SDM Monte Carlo Simulator

[![tests](https://github.com/Wesley-Taruna/Aegis-Monte-carlo/actions/workflows/test.yml/badge.svg)](https://github.com/Wesley-Taruna/Aegis-Monte-carlo/actions/workflows/test.yml)

A Monte Carlo evaluation of **how strict a server's counter check should be** when verifying NFC tap messages from an NXP NTAG 424 DNA TT tag (Secure Dynamic Messaging, SDM) on a gold bar.

- **Too strict:** honest buyers are rejected when their uploads arrive out of order.
- **Too loose:** an attacker who captured a message that never reached the server can use it later (delayed relay).

Only the **server's verification policy** is evaluated. This is a software-level study. It makes **no claim** that the physical chip, the radio link, the phone app or any full system is secure.

---

## Quick start

Requires Node.js 20 or newer (tested on 20 and 22). Only built-in modules are used; there is nothing to `npm install`.

```bash
npm test
```
Runs 51 unit tests: RFC 4493, AN12196 Rev. 2.0, every verifier rule, the information boundary, the floor formula and the gold schedule.

```bash
npm run demo
```
Shows one honest tap, one fake tap and one replay, explained in plain words.

```bash
npm run experiments
```
Runs E0–E5 plus A1/A5 at N = 10,000 per configuration, for both owner scenarios (about 5 minutes on 8 cores), and writes `results/`.

```bash
npm run quick
```
The same experiments at N = 1,000 (about 12 s), for trying things out.

```bash
npm run web
```
Opens the web view at http://localhost:3000.

```bash
npm run plots
```
Makes PNG figures in `plots/` from the CSVs (needs Python 3 + matplotlib).

### The web view

`npm run web` starts a small local server (Node's built-in `http`) and serves a dashboard with one tab per experiment:

| Tab | What it shows |
|---|---|
| Overview | Headline numbers, the order of the verifier's checks, the scope statement |
| E0 Correctness | RFC 4493 and AN12196 known-answer tests, pass/fail |
| Demo | One honest tap, one clone tap, one replay, in plain words |
| Trace explorer | **One simulated trial drawn as a timeline**: every tap, every lost upload, every delayed upload, every attacker message, and the server's verdict on each (hover for details). Change W, T, loss, reordering and the attacker, then click "Simulate trial". This is the best way to *see* why a message is accepted or rejected. |
| E1–E5, A1 & A5 | Charts with 95% Wilson intervals, plus full tables. E2–E4 have a switch between the two owner scenarios. |
| Assumptions | Every ASSUMPTION from the config, plus the full config file |

"Run all experiments" (or "Re-run" on a tab) re-runs the experiments with the N and seed typed in the header. It overwrites `results/`.

---

## Tests

Every push to this repository runs the full test suite on GitHub Actions (Node.js 20 and 22): see [.github/workflows/test.yml](.github/workflows/test.yml) and the badge above.

```bash
npm test
```

It runs 51 tests with Node's built-in `node:test` runner. Expected result: `# pass 51`, `# fail 0`.

| File | Tests | What they check |
|---|---|---|
| `test/cmac.test.js` | 9 | AES-CMAC against RFC 4493 (subkeys and all four examples); the seeded random number generator |
| `test/sdm.test.js` | 11 | SDM session vector, session key and MAC against NXP AN12196 Rev. 2.0, Tables 1, 4 and 5; tag counter and tamper behaviour |
| `test/verifier.test.js` | 17 | Each server rule on its own (MAC, duplicate, window W, time T, rate limit, unknown UID, tamper); the verifier refusing simulation ground truth |
| `test/simulate.test.js` | 8 | Reproducibility from the seed; no honest rejects on a perfect channel; each attacker rejected or accepted by the rule expected; the gold-sale schedule |
| `test/stats.test.js` | 6 | Wilson interval, the 3/N bound, the MAC-guessing formula and the delayed-relay floor formula |

The workflow then runs two more checks:
- **E0:** the 16 known-answer checks must pass (`node src/run-all.js --only E0`).
- **Smoke run:** every experiment runs end to end at N = 200 (`node src/run-all.js --trials 200`).

The published numbers in `results/` come from the full run (`npm run experiments`, N = 10,000, seed 20261031).

---

## Files

```
.github/workflows/      GitHub Actions: runs the tests on every push
CITATION.cff            How to cite this software
config/default.json     ALL parameters (seed, N, policy, channel, attackers, experiment grids)
src/rng.js              Seeded random number generator (mulberry32). Math.random() is never used.
src/cmac.js             AES-CMAC per RFC 4493, built on AES-128-ECB from Node's crypto module
src/sdm.js              Tag model: 24-bit counter, tamper status, AN12196 session key + truncated MAC
src/verifier.js         SERVER POLICY (the thing evaluated). Sees only server data.
src/channel.js          Owner tap schedule (steady or gold-sale scenario); upload loss, delay and reordering
src/floor.js            Analytical formula for the delayed-relay floor (checked in E5)
src/attackers.js        A1 clone, A2 replay, A3 MAC guessing, A4 delayed relay, A5 tamper forgery
src/simulate.js         Runs one trial: taps -> channel -> verifier, keeps the truth labels outside the verifier
src/jobs.js             N trials of one kind under one configuration, reduced to counts
src/stats.js            Wilson score interval, 3/N rule, guessing formula
src/parallel.js, worker.js   Run jobs on several CPU cores (results do not depend on core count)
src/experiments/        E0-E5, A1A5 definitions + runner that saves results
src/demo.js             Stage-4 demo
src/vectors.js          RFC 4493 and AN12196 Rev. 2.0 test vectors, each with its source
src/run-all.js          Command-line runner
server.js, web/         Local web view
test/                   node:test unit tests
results/                <id>.csv, <id>.json, <id>.config-used.json for every run
plots/make_plots.py     PNG figures from the CSVs
docs/                   Put AN12196.pdf here (Rev. 2.0, 4 March 2025, was used for the vectors)
```

---

## How the code enforces "the verifier only sees server data"

1. The simulation keeps every message's truth labels (`isAttack`, `attackType`, `createdAt`, `reordered`) in `simulate.js`, next to the message, never inside it.
2. The only bridge to the server is `toServerView(message, serverReceiveTime)`. It copies exactly `{ uid, counter, tamperStatus, mac, serverReceiveTime }`.
3. `Verifier.verify()` **throws** if it receives any other field. A unit test checks this.
4. Attacks are never hard-coded to fail. Every attack message goes through the same `verify()` call as honest ones. Only the MAC and counter logic decide.

## The verifier's checks (in order; the first failure is recorded)

| # | Rule | Rejects when |
|---|---|---|
| 1 | `unknown_uid` | no key stored for this UID |
| 2 | `rate_limit` | ≥ R attempts for this tag in the last `windowSeconds` (failed MACs count; blocked attempts do not) |
| 3 | `mac` | the MAC differs from the one computed with the tag key over UID, counter and tamper status |
| 4 | `duplicate` | this counter was already accepted |
| 5 | `window` | counter < lastAccepted − W |
| 6 | `time` | counter < lastAccepted, the time rule T is on, and the message arrived more than T s after the last acceptance (server clock only) |

A message that passes all checks is **accepted**, or **compromised** if its MAC-valid tamper status is "open". Counters greater than `lastAccepted` are always fine, because lost uploads create forward gaps.

---

## Experiments

| ID | Question | Output |
|---|---|---|
| **E0** | Does the crypto match the standards byte for byte? | `results/E0.*`, must pass first |
| **E1** | Does simulated MAC guessing match P = 1 − (1 − 2⁻ᵇ)ⁿ for b ∈ {8, 12, 16}? What is the bound for b = 64 under the rate limit? | `E1.csv`, `E1_b64.csv` |
| **E2** | **Main result.** Honest false rejects vs A2/A4 acceptance for W ∈ {0,1,2,4,8,16,32} × T ∈ {off, 5, 30, 300 s} | `E2.csv` |
| **E3** | How sensitive are honest false rejects to pLoss × pReorder? | `E3.csv` |
| **E4** | Delayed-relay acceptance vs attacker delay D, split before/after the owner's next upload | `E4.csv` |
| **E5** | Does the delayed-relay floor match its formula F(D) = exp(−λ q E[(D − X)⁺])? | `E5.csv` |
| **A1/A5** | Clone and tamper-flag forgery at default settings | `A1A5.csv` |

E2, E3 and E4 are each run for **two owner scenarios** (column `scenario` in the CSVs):

- **steady**: one owner taps about every 60 s, 20 taps per trial. This is the original comparison scenario.
- **gold**: the realistic gold-bar case. The bar changes hands in **sales**. In each sale the seller and buyer tap 2–4 times within a few minutes (gaps averaging 90 s). Between sales the bar is stored for 1–28 days. Each trial is 6 sales. Attackers who need physical access (A1, A4, A5) act during a sale, or up to 2 minutes after its last tap while the bar is still on the counter.

Every rate is reported with its count, N and 95% Wilson score interval. When the count is 0, the 3/N upper bound is given too.

### Known-answer vectors (E0)

All E0 values were copied from their source documents. Nothing is from memory.

| Source | What is checked |
|---|---|
| RFC 4493 §4 (rfc-editor.org) | AES-128(K, 0), subkeys K1 and K2, and the four AES-CMAC examples (0, 16, 40, 64 bytes) |
| NXP AN12196 Rev. 2.0 (4 March 2025), Table 1 | SV2 and KSesSDMFileReadMAC for UID 04C767F2066180, SDMReadCtr 010000 |
| AN12196 Table 4 | SV2, session key and SDMMAC `94EED9EE65337086` (zero-length MAC input) |
| AN12196 Table 5 | SV2, session key, full CMAC `81EC45C1…AEF6` and SDMMAC `ECC1E7F6C6C73BF6`, with MAC input `CEE9A53E3E463EF1F459635736738962&cmac=` |

### The delayed-relay floor formula (checked in E5)

A delayed relay is *"before"* when it reaches the server before any newer owner upload has. Its counter is then the newest the server has seen, so **every** W and T accepts it. For the steady scenario:

1. Owner taps form a Poisson process with rate λ = 1 / meanTapGapSeconds. A Poisson process is memoryless, so the taps after the capture moment are again Poisson with rate λ.
2. Each later upload is delivered with probability q = 1 − pLoss, after a random delay X (the base delay, plus the reordering extra delay with probability pReorder).
3. A later tap made s seconds after capture has arrived by time D when s + X ≤ D. Thinning and shifting a Poisson process keeps it Poisson, so the number of newer uploads that have arrived by D is Poisson with mean m(D) = λ q E[(D − X)⁺].
4. The relay is "before" exactly when that number is 0, so

   **F(D) = exp(−λ q E[(D − X)⁺])**

E[(D − X)⁺] has a closed form for the uniform base delay and is integrated numerically (Simpson's rule) over the uniform reordering delay; see `src/floor.js`.

The formula is exact when the owner never stops tapping. E5 therefore compares it with the simulation at 20 taps per trial (the normal length) and at 200. **No formula is given for the gold scenario**, because its bursty taps are not a Poisson process. E4 reports its floor from simulation only.

### The time rule T: a condition, not a recommendation

A late honest upload and a delayed relay look the same to the server: both carry an older counter. The only difference it can measure is how late they arrive. So:

> **T only helps when honest upload delays are much shorter than attacker delays.**

This is stated as a condition, not as advice to switch T on. With these assumptions, honest late uploads arrive up to about 5 minutes late, so:
- if the attacker waits less than that, no T separates the two;
- if the attacker waits much longer (hours or days, which is plausible in the gold scenario), a T of a few minutes rejects the late relays and costs honest users very little.

Whether real attackers wait longer than real honest delays is an empirical question this simulation cannot answer.

### Results at a glance (seed 20261031, N = 10,000 per configuration)

These come from the current `results/`. Re-run to regenerate them, and never edit them by hand.

- **E0:** all 16 known-answer checks pass (RFC 4493 subkeys and 4 examples; AN12196 Rev. 2.0 Tables 1, 4, 5).
- **E2 trade-off, steady scenario** (60 s taps; D = 30 s for A4):

  | W | T | Honest false rejects | A4 accepted | A2 accepted |
  |---|---|---|---|---|
  | 0 | off | 4.16% | 63.2% | 0 / 9,980 |
  | 4 | off | 0.65% | 100% | 0 / 9,971 |
  | 4 | 30 s | 2.52% | 100% | 0 / 9,974 |
  | 4 | 5 s | 3.54% | 71.0% | 0 / 9,976 |
  | 32 | off | 0.00% | 100% | 0 / 9,981 |

- **E2 trade-off, gold scenario** (sales; D = 30 s for A4):

  | W | T | Honest false rejects | A4 accepted |
  |---|---|---|---|
  | 0 | off | 2.46% | 84.3% |
  | 2 | off | 0.12% | 99.98% |
  | 4 | off | 0.00% | 100% |
  | 4 | 30 s | 1.83% | 100% |
  | 4 | 300 s | 0.00% | 100% |

- **The floor:** a relay that reaches the server before the owner's next upload carries the newest counter and passes for every W and T.
  - **Steady scenario:** at D = 30 s, 63% of relays are in this position. The share falls to about 1% by D = 5 min, as the formula predicts (E5).
  - **Gold scenario:** about 43% of captured messages are still accepted **1 day later** under every policy, and 35% after 7 days. These are messages captured after the last upload of a sale: nothing newer arrives until the next sale, 1–28 days later. ⚠ That 43% level depends mostly on the assumed 2-minute window after the last tap in which an attacker can still reach the bar.
- **The time-rule condition, in data (E4, policy W = 4, T = 300 s):**
  - **Gold scenario:** honest false rejects are 0% at every reordering rate (E3), because 300 s covers every honest delay. Relays delayed 30 min or more are cut down to the floor. Relays delayed 5 min or less all pass, because the attacker is no slower than an honest late upload.
  - **Steady scenario:** the same T leaves 95% of 2-minute relays accepted.
- **E5 floor formula:** F(D) = exp(−λ q E[(D − X)⁺]) is inside the 95% interval for all 7 delays up to 5 min with 200-tap trials. With 20-tap trials and long delays, the end-of-trial effect (≈ pLoss/K) explains the gaps; see the next section.
- **A1, A5:** 0 / 10,000 accepted each (95% upper bound 0.03%). All were rejected by the MAC rule.
- **A2:** 0 of 558,395 replays accepted across both scenarios and all policies.
- **b = 64:** with 10 guesses per minute for 10 years on one tag, P(success) ≈ 2.8 × 10⁻¹².

### Things that may look surprising (reported, not "fixed")

1. **E1: 2 of 12 formula values fall just outside the 95% interval** (b = 16 with n = 1 and n = 1000). With 12 comparisons at 95%, about 0.6 misses are expected by chance. To check, b = 16, n = 1000 was re-run with seeds 1–6 (60,000 trials pooled): 1.485% simulated vs 1.514% formula, 0.6 standard errors apart. No bug was found. The published-seed result is kept as it is.
2. **E5: the formula misses some simulated points, for a reason that can be calculated.** The formula assumes the owner never stops tapping; a trial has K taps.
   - **Mid-range D with K = 20:** the capture moment always lies before the last tap, which slightly shortens the wait, so the simulation is 1–2 points below the formula. With K = 200 this disappears.
   - **Long D:** with probability about 1/K the capture falls in the trial's last gap. If that final upload is lost, nothing newer ever arrives. This leaves a residual floor of about pLoss/K: 0.25% for K = 20 (simulated 0.25–0.30%) and 0.025% for K = 200 (simulated 0.02–0.06%), where the formula says 0.
3. **W = 32 with no time rule accepts every relay, at every delay, in both scenarios.** No stolen counter is ever more than about 20 behind, so W = 32 never rejects anything. Under these assumptions, any W at or above the number of taps per trial means "accept any counter not yet seen".
4. **Gold: one relay delayed 7 days was accepted "after" with W = 4, T = 300 s** (1 of 6,519). It arrived during the next sale within 300 s of an owner acceptance and within W of the newest counter, so every rule was satisfied. That's a real, rare coincidence, not a bug.
5. **A2 replays are never accepted** in any configuration. That's expected: the duplicate rule and the window rule both catch them. Its 3/N bounds are reported anyway.

### Analytical check for honest false rejects

**No closed-form formula was derived.** A message is rejected when a later counter (at least W + 1 taps later) arrives before it, given exponential tap gaps, a uniform base delay, a random extra reordering delay, losses, and a finite number of taps per trial. An approximation is possible (for example, ignoring base delays and end-of-trial effects), but it would be an approximation and is not presented as an exact check. The analytical comparisons in this project are the MAC-guessing formula (E1) and the delayed-relay floor formula (E5).

---

## All assumptions

Each of these is also marked in `config/default.json` and listed in the web view's Assumptions tab.

**Tag model (NXP AN12196)**
1. SDM session key: SV2 = `3CC3 0001 0080 ‖ UID ‖ SDMReadCtr (LSB first)`; KSesSDMFileReadMAC = CMAC(K, SV2); SDMMAC = odd-indexed bytes of CMAC(KSes, MAC input), which gives 8 bytes.
2. **Plaintext mirroring** of UID and counter (not the encrypted PICCData mode).
3. **Deployment requirement: the tag is configured with `TTStatusOffset` inside the MAC input range** (`tamperInMac = true`). The NTAG 424 DNA TT data sheet [2] (Sec. 9.3.4–9.3.5) computes the SDMMAC over the file data from `SDMMACInputOffset` to `SDMMACOffset − 1`. It mirrors the tamper status at `TTStatusOffset`, which may sit anywhere that doesn't overlap the PICC data or the SDMMAC. So the MAC protects the tamper status **only** when `TTStatusOffset` is set inside that range. The A5 result applies only to tags configured this way; a unit test shows the unchanged-MAC forgery succeeds when `tamperInMac = false`.
4. The MAC input is the ASCII URL text from the UID mirror up to the MAC mirror: `<UID>&ctr=<CTR>&tt=<C|O>&mac=`. The counter is 6 hex digits, most significant first. This layout is a modeling choice; the session-key derivation and truncation are what AN12196 [1] fixes.
   - **Simplification of the tamper status.** The real chip mirrors two ASCII characters, `TTPermStatus || TTCurrStatus` (the permanent status, then the current one), each `C` (closed), `O` (open) or `I` (invalid: the tamper feature is not enabled) [2, Sec. 9.3.5, 10.2]. The model mirrors one `C`/`O` character and assumes the feature is enabled.
   - **Why no result changes:** altering any covered character changes the MAC input in the same way.
5. The counter starts at 0 and the first tap gives 1. It is 24-bit and increases on every tap, uploaded or not.
6. Tag keys and UIDs come from the seeded RNG. They are for simulation only.
7. Sources for the tag model:
   - [1] NXP AN12196, *NTAG 424 DNA and NTAG 424 DNA TagTamper features and hints*, Rev. 2.0, 4 Mar 2025. Used for the SUN MAC computation and the test vectors.
   - [2] NXP NT4H2421Tx, *NTAG 424 DNA TT – Secure NFC T4T compliant IC with Tag Tamper feature*, product data sheet, Rev. 3.0, 31 Jan 2019, Doc. 465530, https://www.nxp.com/docs/en/data-sheet/NT4H2421Tx.pdf. Used for tamper-status mirroring and MAC coverage.

**Server policy**
8. The rate limit is a sliding window: 10 attempts per tag per 60 s. Failed MAC checks count; attempts blocked by the rate limit do not count again.
9. The time rule compares the arrival time with the server time of the **last acceptance of any kind** (forward or backward).
10. Default policy for A1/A5: W = 4, T = 30 s. The policies selected for E3 and E4 are (W = 0, T off), (4, 30 s), (4, 300 s) and (32, off). (4, 300 s) was added to show the time-rule condition; it is not a recommendation.
11. The server processes messages in arrival order. Arrival ties keep the order in which they were sent.

**Owner and channel (not measured; assumed)**
12. Steady scenario: 20 owner taps per trial, with exponential gaps averaging 60 s.
12b. Gold scenario: 6 sales per trial, 2–4 taps per sale (uniform), within-sale gaps exponential with a 90 s mean, quiet periods of 1–28 days (uniform) between sales. Attackers needing physical access act within a sale or up to 120 s after its last tap.
13. pLoss = 0.05: a lost upload never arrives, but its counter was still used.
14. Base upload delay: uniform 0.2–2 s.
15. pReorder = 0.05: a reordered upload gets an extra delay, uniform 5–300 s.

**Attackers**
16. A1: one clone message per trial, at a random time during the owner's activity, with a counter just above the newest real counter.
17. A2: replays a randomly chosen accepted owner message after a uniform 1–600 s delay.
18. A3: one fresh counter, random MACs, spaced just over 6 s apart so the rate limit never blocks them. It stops at the first success.
19. A4: the attacker taps the genuine tag at a uniformly random time within the activity windows (steady: from the start of the trial to the last owner tap; gold: during a sale, plus the 120 s tail) and submits after D seconds. For the server, this is identical to intercepting an upload that never arrives.
20. A5: the seal is open. The attacker taps, flips "open" to "closed", and submits with the unchanged MAC or one random guess.

**Statistics**
21. Honest false-reject rates count delivered messages. Messages within one trial are not independent (a single late upload can affect its neighbours), so the Wilson intervals for honest rates are somewhat too narrow. Attack rates use one attack per trial, so their trials are independent.
22. All published numbers use seed 20261031. Each experiment derives its own random stream from (seed, configuration label), so the results don't depend on run order or core count.
