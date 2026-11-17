// Dashboard logic: loads results from the local server and draws each tab.
(function () {
  const { lineChart, traceChart, fmtPct, fmtT, esc } = window.Charts;
  const $ = (sel, root = document) => root.querySelector(sel);
  const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
  const RULES = ['rate_limit', 'mac', 'duplicate', 'window', 'time'];
  let CONFIG = null;
  let RESULTS = {};
  let SCENARIO = 'steady';
  try { SCENARIO = localStorage.getItem('aegis-scenario') || 'steady'; } catch (e) { /* ignore */ }

  // ---------- helpers ----------
  const api = (p, opts) => fetch(p, opts).then((r) => r.json());
  const tLab = (T) => (T === null || T === 'off' ? 'off' : `${String(T).replace('s', '')} s`);

  // "4.2% [3.9, 4.5]" or "0 / 19,001 (≤ 0.016%)"
  function rateCell(s, prefix = '') {
    const g = (k) => s[prefix + k];
    if (g('N') === 0 || g('N') === undefined) return '<span class="ci">no data</span>';
    if (g('count') === 0) return `0 / ${g('N').toLocaleString()} <span class="ci">(&le; ${fmtPct(g('upper3N'))}, 3/N)</span>`;
    return `${fmtPct(g('rate'))} <span class="ci">[${fmtPct(g('wilsonLow'))}, ${fmtPct(g('wilsonHigh'))}]</span>`;
  }
  function rateTip(s, prefix, title) {
    const g = (k) => s[prefix + k];
    const base = `<b>${title}</b><br>${g('count').toLocaleString()} of ${g('N').toLocaleString()} = ${fmtPct(g('rate'))}`;
    const ci = `<br>95% Wilson: ${fmtPct(g('wilsonLow'))} – ${fmtPct(g('wilsonHigh'))}`;
    return base + ci + (g('count') === 0 ? `<br>95% upper bound 3/N: ${fmtPct(g('upper3N'))}` : '');
  }
  function point(s, prefix, x, title, extra = {}) {
    return { x, y: s[prefix + 'rate'], lo: s[prefix + 'wilsonLow'], hi: s[prefix + 'wilsonHigh'], upper: s[prefix + 'upper3N'], tip: rateTip(s, prefix, title), ...extra };
  }
  function table(cols, rows, cls = '') {
    return `<div class="table-wrap"><table class="${cls}"><thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}">${c.h}</th>`).join('')}</tr></thead><tbody>${
      rows.map((r) => `<tr>${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.f(r)}</td>`).join('')}</tr>`).join('')
    }</tbody></table></div>`;
  }
  // Rows of one owner scenario (results saved before scenarios existed count as "steady").
  const inScenario = (rows, sc = SCENARIO) => rows.filter((x) => (x.scenario ?? 'steady') === sc);
  const scoped = (r) => (r ? { ...r, rows: inScenario(r.rows) } : r);
  function scenarioSwitch() {
    const names = CONFIG.experiments.scenarios ?? ['steady'];
    if (names.length < 2) return '';
    return `<div class="seg" role="radiogroup" aria-label="Owner scenario">${names.map((n) =>
      `<button role="radio" data-scenario="${n}" aria-checked="${n === SCENARIO}">${esc(CONFIG.scenarios?.[n]?.label ?? n)}</button>`).join('')}</div>`;
  }
  function scenarioNote() {
    const sc = CONFIG.scenarios?.[SCENARIO];
    return sc?._note ? `<p class="sub" style="margin:6px 0 0">${esc(sc._note.replace('ASSUMPTION: ', 'Assumption: '))}</p>` : '';
  }
  // 30 -> "30 s", 3600 -> "1 h", 86400 -> "1 d"
  function fmtDur(s) {
    if (s >= 86400 && s % 86400 === 0) return `${s / 86400} d`;
    if (s >= 3600 && s % 3600 === 0) return `${s / 3600} h`;
    if (s >= 60 && s % 60 === 0 && s >= 600) return `${s / 60} min`;
    return `${s.toLocaleString()} s`;
  }
  function timeRuleCallout() {
    return `<div class="callout"><strong>Time rule T is a condition, not a recommendation.</strong> A late honest upload and a delayed relay both carry an older counter, and the server can only tell them apart by how late they arrive. So T only helps when honest upload delays are much shorter than attacker delays. Here honest late uploads are delayed up to ${CONFIG.channel.reorderExtraDelaySeconds[1]} s; compare that with the attacker delay D.</div>`;
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-scenario]');
    if (!b) return;
    SCENARIO = b.dataset.scenario;
    try { localStorage.setItem('aegis-scenario', SCENARIO); } catch (err) { /* ignore */ }
    renderPanel(active());
  });
  function notes(list) { return list && list.length ? `<ul class="notes">${list.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''; }
  function meta(r) { return `<p class="sub">Seed ${r.seed} &middot; N = ${r.trialsPerConfig.toLocaleString()} trials per configuration &middot; generated ${new Date(r.generatedAt).toLocaleString()}</p>`; }
  function missing(id) {
    return `<div class="card"><div class="empty">No saved results for ${id} yet. <button data-run="${id}">Run ${id}</button></div></div>`;
  }
  function runButton(id) { return `<button data-run="${id}">Re-run ${id}</button>`; }
  function header(title, lede, id) {
    return `<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start"><div><h2>${title}</h2><p class="lede">${lede}</p></div>${id ? runButton(id) : ''}</div>`;
  }

  // ---------- tabs ----------
  function setupTabs() {
    const nav = $('#tabs');
    const panels = [...document.querySelectorAll('section.panel')];
    nav.innerHTML = panels.map((p) => `<button role="tab" data-target="${p.id}">${p.dataset.tab}</button>`).join('');
    const select = (id) => {
      for (const p of panels) p.classList.toggle('active', p.id === id);
      for (const b of nav.children) b.setAttribute('aria-selected', b.dataset.target === id);
      try { localStorage.setItem('aegis-tab', id); } catch (e) { /* storage unavailable */ }
      renderPanel(id);
    };
    nav.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) select(b.dataset.target); });
    let saved = null;
    try { saved = localStorage.getItem('aegis-tab'); } catch (e) { /* ignore */ }
    select(saved && document.getElementById(saved) ? saved : 'p-overview');
  }
  const active = () => document.querySelector('section.panel.active')?.id;
  function renderPanel(id) {
    const fn = RENDER[id];
    if (fn) fn($('#' + id));
  }

  // ---------- Overview ----------
  function renderOverview(root) {
    const e0 = RESULTS.E0, e2 = RESULTS.E2, a = RESULTS.A1A5, e4 = RESULTS.E4;
    const W = CONFIG.verifier.W, T = CONFIG.verifier.T;
    const tKey = T === null ? 'off' : `${T}s`;
    const steadyRows = e2 ? inScenario(e2.rows, 'steady') : [];
    const goldRows = e2 ? inScenario(e2.rows, 'gold') : [];
    const def = steadyRows.find((r) => r.W === W && r.T === tKey);
    const strict = steadyRows.find((r) => r.W === 0 && r.T === 'off');
    const goldDef = goldRows.find((r) => r.W === W && r.T === tKey);
    const goldDay = e4 ? inScenario(e4.rows, 'gold').find((r) => r.W === W && r.T === tKey && r.D === 86400) : null;
    const e5 = RESULTS.E5;
    const tiles = [
      { k: 'E0 correctness', v: e0 ? (e0.allPass ? 'Pass' : 'FAIL') : '–', d: e0 ? `${e0.rows.filter((r) => r.pass).length} / ${e0.rows.length} known-answer tests` : 'not run' },
      { k: `Honest false rejects (W=${W}, T=${tLab(T)})`, v: def ? fmtPct(def.frr_rate) : '–', d: def ? `of ${def.frr_N.toLocaleString()} delivered genuine messages` : 'run E2' },
      { k: 'Honest false rejects (strict W=0)', v: strict ? fmtPct(strict.frr_rate) : '–', d: 'out-of-order uploads always rejected' },
      { k: `A4 delayed relay accepted (D=${CONFIG.attackers.A4.defaultDelaySeconds} s)`, v: def ? fmtPct(def.a4_rate) : '–', d: def ? `before next upload: ${def.a4before_N.toLocaleString()} relays, all fresh counters` : '' },
      { k: `Gold sales: honest false rejects (W=${W}, T=${tLab(T)})`, v: goldDef ? fmtPct(goldDef.frr_rate) : '–', d: goldDef ? `of ${goldDef.frr_N.toLocaleString()} delivered genuine messages` : 'run E2' },
      { k: `Gold sales: relays accepted 1 day later (W=${W}, T=${tLab(T)})`, v: goldDay ? fmtPct(goldDay.a4_rate) : '–', d: goldDay ? `all of them "before": ${fmtPct(goldDay.shareBefore)} arrive before the next sale` : 'run E4' },
      (() => {
        const long = e5 ? e5.rows.filter((x) => x.tapsPerTrial === Math.max(...e5.rows.map((y) => y.tapsPerTrial)) && x.D <= 300) : [];
        return { k: 'Floor formula vs simulation (E5)', v: e5 ? `${long.filter((x) => x.formulaInsideWilson).length} / ${long.length}` : '–', d: e5 ? `inside the 95% interval (long trials, D ≤ 5 min); see E5 for the end-of-trial effect` : 'run E5' };
      })(),
      { k: 'A2 replays accepted (all W, T)', v: e2 ? `${e2.rows.reduce((s, r) => s + r.a2_count, 0)}` : '–', d: e2 ? `of ${e2.rows.reduce((s, r) => s + r.a2_N, 0).toLocaleString()} replays` : '' },
      { k: 'A1 clones / A5 forgeries accepted', v: a ? `${a.rows.reduce((s, r) => s + r.count, 0)}` : '–', d: a ? `of ${a.rows.reduce((s, r) => s + r.N, 0).toLocaleString()} attempts` : '' },
    ];
    root.innerHTML = `
      ${header('Overview', 'When a buyer taps a gold bar\'s NFC tag, the tag sends its UID, a tap counter, a tamper status and a MAC (a secret-key stamp). The server checks the MAC and the counter. This simulator asks how strict the counter check should be: too strict rejects honest buyers whose uploads arrive out of order; too loose lets a captured-but-unsent message be used later.')}
      <div class="callout"><strong>Scope.</strong> This is a software-level evaluation of the server's verification policy only - not the chip, radio link, phone app or blockchain. All channel rates are assumptions (see the Assumptions tab).</div>
      <div class="tiles">${tiles.map((t) => `<div class="tile"><div class="k">${t.k}</div><div class="v">${t.v}</div><div class="d">${t.d}</div></div>`).join('')}</div>
      <div class="grid2">
        <div class="card"><h3>How a message is checked</h3>
          <ol class="notes" style="color:var(--text)">
            <li><b>Rate limit</b> - at most ${CONFIG.verifier.rateLimit.maxAttempts} attempts per tag per ${CONFIG.verifier.rateLimit.windowSeconds} s.</li>
            <li><b>MAC</b> - recompute with the tag key; must match exactly (covers UID, counter${CONFIG.tag.tamperInMac ? ', tamper status' : ''}).</li>
            <li><b>Duplicate</b> - this counter must not have been accepted before.</li>
            <li><b>Window W</b> - newer counters always OK; older ones only if within W of the newest.</li>
            <li><b>Time rule T</b> (optional) - an older counter must arrive within T seconds of the last acceptance, on the server's clock.</li>
          </ol>
        </div>
        <div class="card"><h3>What each tab shows</h3>
          <ul class="notes" style="color:var(--text)">
            <li><b>E0</b> - the crypto matches RFC 4493 and AN12196 byte for byte.</li>
            <li><b>Demo / Trace explorer</b> - single messages and single trials, step by step.</li>
            <li><b>E1</b> - MAC guessing vs the formula 1 - (1 - 2<sup>-b</sup>)<sup>n</sup>.</li>
            <li><b>E2</b> - the main result: honest false rejects vs replay / delayed-relay acceptance across W and T.</li>
            <li><b>E3</b> - sensitivity to loss and reordering. <b>E4</b> - delayed relay vs attacker delay D.</li>
            <li><b>E5</b> - the delayed-relay floor: formula vs simulation.</li>
            <li>E2-E4 each have two owner scenarios: <b>steady</b> taps about every 60 s, and <b>gold sales</b> (bursts of taps, then days to weeks of quiet).</li>
          </ul>
        </div>
      </div>`;
  }

  // ---------- E0 ----------
  function renderE0(root) {
    const r = RESULTS.E0;
    if (!r) { root.innerHTML = header('E0 Correctness', '', 'E0') + missing('E0'); return; }
    root.innerHTML = header('E0 Correctness', 'Known-answer tests. These must pass before any other result is reported: AES-CMAC against the RFC 4493 test vectors, and the SDM session vector, session key and MAC against the worked examples in NXP AN12196 Rev. 2.0 (Tables 1, 4 and 5).', 'E0') + `
      <div class="card">${meta(r)}
      ${table([
        { h: 'Suite', f: (x) => x.suite },
        { h: 'Test', f: (x) => esc(x.name) },
        { h: 'Expected', f: (x) => `<span class="mono">${x.expected}</span>` },
        { h: 'Computed', f: (x) => `<span class="mono">${x.got}</span>` },
        { h: 'Result', f: (x) => x.pass ? '<span class="badge pass">&#10003; Pass</span>' : '<span class="badge fail">&#10007; Fail</span>' },
      ], r.rows)}
      ${notes(r.notes)}</div>`;
  }

  // ---------- Demo ----------
  async function renderDemo(root) {
    root.innerHTML = header('One honest tap, one fake tap', 'The smallest end-to-end example, in plain words. Every message goes through the same verifier; only the MAC and counter rules decide.') + '<div class="empty">Loading…</div>';
    const steps = await api('/api/demo');
    root.innerHTML = header('One honest tap, one fake tap', 'The smallest end-to-end example, in plain words. Every message goes through the same verifier; only the MAC and counter rules decide.') +
      steps.map((s) => {
        const badge = !s.result ? '' : s.result.outcome === 'rejected'
          ? `<span class="badge fail">&#10007; Rejected: ${s.result.rule}</span>`
          : `<span class="badge pass">&#10003; ${s.result.outcome}</span>`;
        return `<div class="card demo-step"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><h3>${esc(s.title)}</h3>${badge}</div>
          <ul>${s.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
          ${s.message ? `<div class="msg">What the server receives: uid=${s.message.uid} &nbsp;ctr=${s.message.counter} &nbsp;tt=${s.message.tamperStatus} &nbsp;mac=${s.message.mac}</div>` : ''}</div>`;
      }).join('');
  }

  // ---------- Trace explorer ----------
  function renderTrace(root) {
    const c = CONFIG;
    root.innerHTML = header('Trace explorer', 'One simulated trial, message by message. Each dot is an upload as the server receives it; the grey line runs from the tap to the arrival, so long lines are delayed (reordered) uploads. Hover any mark for the server\'s verdict.') + `
      <div class="card">
        <div class="trace-controls">
          <label>Window W <input id="tr-W" type="number" min="0" value="${c.verifier.W}"></label>
          <label>Time rule T (s) <input id="tr-T" type="text" value="${c.verifier.T ?? 'off'}"></label>
          <label>pLoss <input id="tr-loss" type="number" step="0.01" min="0" max="1" value="${c.channel.pLoss}"></label>
          <label>pReorder <input id="tr-re" type="number" step="0.01" min="0" max="1" value="${Math.max(c.channel.pReorder, 0.15)}"></label>
          <label>Scenario <select id="tr-sc">${(c.experiments.scenarios ?? ['steady']).map((n) => `<option value="${n}" ${n === SCENARIO ? 'selected' : ''}>${esc(c.scenarios?.[n]?.label ?? n)}</option>`).join('')}</select></label>
          <label>Owner taps (steady) <input id="tr-taps" type="number" min="1" max="200" value="${c.owner.tapsPerTrial}"></label>
          <label>Attacker <select id="tr-att"><option value="none">none</option><option value="A1">A1 clone</option><option value="A2">A2 replay</option><option value="A4" selected>A4 delayed relay</option></select></label>
          <label>Relay delay D (s) <input id="tr-D" type="number" min="0" value="${c.attackers.A4.defaultDelaySeconds}"></label>
          <label>Trial # <input id="tr-trial" type="number" min="1" value="1"></label>
          <button class="primary" id="tr-go">Simulate trial</button>
          <button id="tr-next">Next trial &rarr;</button>
        </div>
        <div id="tr-summary" class="sub"></div>
        <div id="tr-chart"></div>
      </div>
      <div class="card"><h3>Server log for this trial</h3><p class="sub">Messages in the order the server received them. The verifier saw only the server columns; "who" and "reordered" are hidden simulation labels.</p><div id="tr-table"></div></div>`;
    const go = async () => {
      const q = new URLSearchParams({
        W: $('#tr-W').value, T: $('#tr-T').value.trim() || 'off', pLoss: $('#tr-loss').value, pReorder: $('#tr-re').value,
        taps: $('#tr-taps').value, scenario: $('#tr-sc').value, attack: $('#tr-att').value, D: $('#tr-D').value, trial: $('#tr-trial').value,
      });
      const tr = await api('/api/trace?' + q);
      const rej = tr.log.filter((e) => !e.isAttack && e.result.outcome === 'rejected').length;
      const att = tr.log.filter((e) => e.isAttack);
      $('#tr-summary').innerHTML = `W = ${tr.policy.W}, T = ${tLab(tr.policy.T)} &middot; ${tr.ownerTaps} owner taps, ${tr.ownerLost} lost, ${tr.log.filter((e) => !e.isAttack).length} delivered, <b>${rej} honest rejected</b>` +
        (att.length ? ` &middot; attacker: <b>${att.map((e) => e.result.outcome === 'rejected' ? `rejected (${e.result.rule})` : 'ACCEPTED').join(', ')}</b>` : '');
      traceChart($('#tr-chart'), tr);
      $('#tr-table').innerHTML = table([
        { h: 'Arrival', num: true, f: (e) => fmtT(e.time) },
        { h: 'Counter', num: true, f: (e) => e.counter },
        { h: 'Verdict', f: (e) => e.result.outcome === 'rejected' ? `<span class="badge fail">&#10007; ${e.result.rule}</span>` : `<span class="badge pass">&#10003; ${e.result.outcome}</span>` },
        { h: 'Who (hidden)', f: (e) => e.isAttack ? `<b>Attacker ${e.attackType}</b>${e.attackType === 'A4' ? (e.ownerAheadAtArrival ? ' - after owner' : ' - before owner') : ''}` : 'Owner' },
        { h: 'Reordered (hidden)', f: (e) => e.reordered ? 'yes' : '' },
      ], tr.log, 'mini-table');
    };
    $('#tr-go').onclick = go;
    $('#tr-next').onclick = () => { $('#tr-trial').value = Number($('#tr-trial').value) + 1; go(); };
    go();
  }

  // ---------- E1 ----------
  function renderE1(root) {
    const r = RESULTS.E1;
    const lede = 'Attacker A3 picks a fresh counter and sends random MACs, spaced so the rate limit never blocks them. Simulated success rates (dots, 95% Wilson whiskers) are compared with the formula 1 - (1 - 2<sup>-b</sup>)<sup>n</sup> (dashed). A hollow triangle marks the 3/N upper bound when no guess succeeded.';
    if (!r) { root.innerHTML = header('E1 MAC guessing', lede, 'E1') + missing('E1'); return; }
    const bits = [...new Set(r.rows.map((x) => x.macBits))];
    const ns = [...new Set(r.rows.map((x) => x.attempts))];
    const nMin = Math.min(...ns), nMax = Math.max(...ns);
    const series = [];
    bits.forEach((b, i) => {
      const color = SERIES[i % SERIES.length];
      series.push({ name: `b = ${b} bits (simulated)`, color, line: false, points: r.rows.filter((x) => x.macBits === b).map((x) => point(x, '', x.attempts, `b = ${b}, n = ${x.attempts}`, { tip: rateTip(x, '', `b = ${b}, n = ${x.attempts}`) + `<br>Formula: ${fmtPct(x.formula, 3)} (${x.formulaInsideWilson ? 'inside' : 'OUTSIDE'} the interval)` })) });
      const curve = [];
      for (let k = 0; k <= 40; k++) { const n = nMin * Math.pow(nMax / nMin, k / 40); curve.push({ x: n, y: -Math.expm1(n * Math.log1p(-Math.pow(2, -b))) }); }
      series.push({ name: `b = ${b} formula`, color, dash: true, markers: false, points: curve, legendHide: true });
    });
    root.innerHTML = header('E1 MAC guessing vs formula', lede, 'E1') + `
      <div class="card">${meta(r)}<div id="e1-chart"></div></div>
      <div class="grid2">
        <div class="card"><h3>Simulated vs formula</h3>${table([
          { h: 'b', num: true, f: (x) => x.macBits },
          { h: 'n', num: true, f: (x) => x.attempts.toLocaleString() },
          { h: 'Simulated [95% Wilson]', f: (x) => rateCell(x) },
          { h: 'Formula', num: true, f: (x) => fmtPct(x.formula, 3) },
          { h: 'Inside?', f: (x) => x.formulaInsideWilson ? '<span class="badge pass">&#10003; yes</span>' : '<span class="badge warn">&#9888; no</span>' },
        ], r.rows)}</div>
        <div class="card"><h3>Real tag, b = 64 (formula only)</h3><p class="sub">n = the most guesses the rate limit allows on one tag over the attack duration.</p>${table([
          { h: 'Attack duration', f: (x) => `${x.attackDays.toLocaleString()} days` },
          { h: 'Max guesses n', num: true, f: (x) => x.maxAttempts.toLocaleString() },
          { h: 'P(success)', num: true, f: (x) => x.formula.toExponential(2) },
        ], r.extra.b64)}${notes(r.notes)}</div>
      </div>`;
    const legendSeries = series.filter((s) => !s.legendHide).concat([{ name: 'formula', color: 'var(--neutral)', dash: true }]);
    const host = $('#e1-chart');
    lineChart(host, { height: 340, x: { type: 'log', domain: [nMin * 0.7, nMax * 1.4], ticks: ns, label: 'guesses per trial n (log scale)', fmt: (v) => v.toLocaleString() }, y: { type: 'log', domain: [1e-5, 1], label: 'P(at least one guess accepted)', fmt: (v) => fmtPct(v) }, series, legend: false });
    host.insertAdjacentHTML('afterbegin', `<div class="legend">${legendSeries.map((s) => `<span><i class="${s.dash ? 'dash' : ''}" style="background:${s.color}"></i>${s.name}</span>`).join('')}</div>`);
  }

  // ---------- E2 ----------
  function renderE2(root) {
    const r = scoped(RESULTS.E2);
    const lede = 'The main result. For each backward window W and time rule T (default channel), how many genuine uploads are wrongly rejected, and how many attack messages get through? A2 = replay of an accepted message; A4 = delayed relay of a captured message that never reached the server.';
    if (!r || !r.rows.length) { root.innerHTML = header('E2 Window sweep', lede, 'E2') + scenarioSwitch() + missing('E2'); return; }
    const Ws = [...new Set(r.rows.map((x) => x.W))];
    const Ts = [...new Set(r.rows.map((x) => x.T))];
    const byT = (prefix, title) => Ts.map((T, i) => ({
      name: `T = ${tLab(T)}`, color: SERIES[i % SERIES.length],
      points: r.rows.filter((x) => x.T === T).map((x) => point(x, prefix, x.W, `W = ${x.W}, T = ${tLab(T)}: ${title}`)),
    }));
    const floor = Ws.map((W) => {
      const rows = r.rows.filter((x) => x.W === W);
      const k = rows.reduce((s, x) => s + x.a4before_count, 0), n = rows.reduce((s, x) => s + x.a4_N, 0);
      return { x: W, y: k / n, tip: `<b>Floor at W = ${W}</b><br>Relays arriving before the owner's next accepted upload: ${fmtPct(k / n)} of all relays<br>These pass for any W and T` };
    });
    const maxFrr = Math.max(...r.rows.map((x) => x.frr_wilsonHigh));
    const D = r.config.attackers.A4.defaultDelaySeconds;
    root.innerHTML = header('E2 Window sweep', lede, 'E2') + scenarioSwitch() + `
      <div class="card">${meta(r)}<p class="sub" style="margin:0">Default channel: pLoss = ${r.config.channel.pLoss}, pReorder = ${r.config.channel.pReorder}, honest late uploads delayed ${r.config.channel.reorderExtraDelaySeconds[0]}-${r.config.channel.reorderExtraDelaySeconds[1]} s. A4 delay D = ${D} s.</p>${scenarioNote()}</div>
      ${timeRuleCallout()}
      <div class="grid2">
        <div class="card"><h3>Honest false-reject rate</h3><p class="sub">Share of delivered genuine uploads the server rejected.</p><div id="e2-frr"></div></div>
        <div class="card"><h3>A4 delayed relay accepted (D = ${D} s)</h3><p class="sub">Dashed grey = the floor: relays that arrive before the owner's next accepted upload carry the newest counter, so no W or T can stop them.</p><div id="e2-a4"></div></div>
      </div>
      <div class="card" style="margin-top:18px"><h3>The trade-off</h3><p class="sub">Each point is one (W, T) policy; labels show W. Down-left is better for both honest users and security.</p><div id="e2-trade"></div></div>
      <div class="card"><h3>All configurations</h3>${table([
        { h: 'W', num: true, f: (x) => x.W },
        { h: 'T', f: (x) => tLab(x.T) },
        { h: 'Honest false rejects [95% CI]', f: (x) => rateCell(x, 'frr_') },
        { h: 'by window / time / rate', f: (x) => `${fmtPct(x.frr_rule_window)} / ${fmtPct(x.frr_rule_time)} / ${fmtPct(x.frr_rule_rate_limit)}` },
        { h: 'A2 replay accepted', f: (x) => rateCell(x, 'a2_') },
        { h: 'A4 accepted', f: (x) => rateCell(x, 'a4_') },
        { h: 'A4 before owner', f: (x) => rateCell(x, 'a4before_') },
        { h: 'A4 after owner', f: (x) => rateCell(x, 'a4after_') },
      ], r.rows)}${notes(r.notes)}</div>`;
    lineChart($('#e2-frr'), { x: { type: 'cat', values: Ws, label: 'backward window W' }, y: { type: 'linear', domain: [0, Math.max(0.01, maxFrr * 1.1)], label: 'honest false-reject rate', fmt: (v) => fmtPct(v) }, series: byT('frr_', 'honest false rejects') });
    lineChart($('#e2-a4'), { x: { type: 'cat', values: Ws, label: 'backward window W' }, y: { type: 'linear', domain: [0, 1], label: 'relays accepted', fmt: (v) => fmtPct(v) }, series: [...byT('a4_', 'A4 accepted'), { name: 'floor (before owner)', color: 'var(--neutral)', dash: true, markers: false, points: floor }] });
    const maxA4 = Math.max(...r.rows.map((x) => x.a4_rate));
    lineChart($('#e2-trade'), {
      height: 340,
      x: { type: 'linear', domain: [0, Math.max(0.01, maxFrr * 1.1)], label: 'honest false-reject rate', fmt: (v) => fmtPct(v) },
      y: { type: 'linear', domain: [Math.max(0, Math.min(...r.rows.map((x) => x.a4_rate)) - 0.05), Math.min(1, maxA4 + 0.03)], label: `A4 relays accepted (D = ${D} s)`, fmt: (v) => fmtPct(v) },
      series: Ts.map((T, i) => ({
        name: `T = ${tLab(T)}`, color: SERIES[i % SERIES.length],
        points: r.rows.filter((x) => x.T === T).sort((a, b) => a.W - b.W).map((x) => ({ x: x.frr_rate, y: x.a4_rate, label: `W${x.W}`, tip: `<b>W = ${x.W}, T = ${tLab(T)}</b><br>Honest false rejects: ${fmtPct(x.frr_rate)}<br>A4 accepted: ${fmtPct(x.a4_rate)}<br>A2 accepted: ${x.a2_count} / ${x.a2_N}` })),
      })),
    });
  }

  // ---------- E3 ----------
  function heatColor(v, max) {
    if (v === 0) return 'var(--seq-0)';
    const steps = 7;
    const idx = Math.min(steps, 1 + Math.floor((Math.sqrt(v / max)) * (steps - 1) + 0.5));
    return `var(--seq-${idx})`;
  }
  function renderE3(root) {
    const r = scoped(RESULTS.E3);
    const lede = 'Honest false-reject rate when the assumed loss rate and reordering rate change, at three selected policies. Darker = more genuine uploads rejected. The numbers in the cells are the rates; hover for counts and intervals.';
    if (!r || !r.rows.length) { root.innerHTML = header('E3 Sensitivity grid', lede, 'E3') + scenarioSwitch() + missing('E3'); return; }
    const policies = [...new Map(r.rows.map((x) => [`${x.W}|${x.T}`, { W: x.W, T: x.T }])).values()];
    const losses = [...new Set(r.rows.map((x) => x.pLoss))];
    const reorders = [...new Set(r.rows.map((x) => x.pReorder))];
    const max = Math.max(...r.rows.map((x) => x.frr_rate), 1e-6);
    const grid = (p) => {
      const rows = r.rows.filter((x) => x.W === p.W && x.T === p.T);
      let h = `<div class="heat" style="grid-template-columns: 64px repeat(${reorders.length}, 1fr)"><div class="hdr">pLoss \\ pReorder</div>${reorders.map((x) => `<div class="hdr">${x}</div>`).join('')}`;
      for (const l of losses) {
        h += `<div class="hdr" style="text-align:right">${l}</div>`;
        for (const re of reorders) {
          const x = rows.find((y) => y.pLoss === l && y.pReorder === re);
          const bg = heatColor(x.frr_rate, max);
          const dark = x.frr_rate / max > 0.35;
          h += `<div class="cell" style="background:${bg};color:${dark ? 'var(--heat-strong-text)' : 'var(--text)'}" data-tip="${esc(`<b>pLoss ${l}, pReorder ${re}</b><br>${rateTip(x, 'frr_', `W = ${p.W}, T = ${tLab(p.T)}`).replace(/^<b>.*?<\/b><br>/, '')}`)}">${fmtPct(x.frr_rate)}</div>`;
        }
      }
      return h + '</div>';
    };
    root.innerHTML = header('E3 Sensitivity grid', lede, 'E3') + scenarioSwitch() + `<div class="card">${meta(r)}${scenarioNote()}</div>
      <div class="grid3">${policies.map((p) => `<div class="card"><h3>W = ${p.W}, T = ${tLab(p.T)}</h3><p class="sub">rows: pLoss &middot; columns: pReorder</p>${grid(p)}</div>`).join('')}</div>
      <div class="scale"><span>0%</span><div class="bar"></div><span>${fmtPct(max)}</span><span style="margin-left:8px">(same scale on all three)</span></div>
      <div class="card" style="margin-top:18px"><h3>Table</h3>${table([
        { h: 'W', num: true, f: (x) => x.W }, { h: 'T', f: (x) => tLab(x.T) },
        { h: 'pLoss', num: true, f: (x) => x.pLoss }, { h: 'pReorder', num: true, f: (x) => x.pReorder },
        { h: 'Honest false rejects [95% CI]', f: (x) => rateCell(x, 'frr_') },
        { h: 'window / time / rate', f: (x) => `${fmtPct(x.frr_rule_window)} / ${fmtPct(x.frr_rule_time)} / ${fmtPct(x.frr_rule_rate_limit)}` },
      ], r.rows)}${notes(r.notes)}</div>`;
    // Tooltips on heat cells.
    const tip = $('#tooltip');
    root.querySelectorAll('.cell[data-tip]').forEach((c) => {
      c.addEventListener('mousemove', (e) => { tip.innerHTML = c.dataset.tip; tip.style.display = 'block'; tip.style.left = e.pageX + 14 + 'px'; tip.style.top = e.pageY + 14 + 'px'; });
      c.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    });
  }

  // ---------- E4 ----------
  function renderE4(root) {
    const r = scoped(RESULTS.E4);
    const lede = 'Attacker A4 captures a valid message (by tapping the bar, or by blocking an upload) and submits it D seconds later while the owner keeps tapping normally. Short delays slip in before the owner\'s next upload; longer ones meet the window and time rules.';
    if (!r || !r.rows.length) { root.innerHTML = header('E4 Delayed relay vs delay D', lede, 'E4') + scenarioSwitch() + missing('E4'); return; }
    const policies = [...new Map(r.rows.map((x) => [`${x.W}|${x.T}`, { W: x.W, T: x.T }])).values()];
    const Ds = [...new Set(r.rows.map((x) => x.D))];
    const floor = Ds.map((D) => {
      const rows = r.rows.filter((x) => x.D === D);
      const k = rows.reduce((s, x) => s + x.before_count, 0), n = rows.reduce((s, x) => s + x.a4_N, 0);
      return { x: D, y: k / n, tip: `<b>Floor at D = ${fmtDur(D)}</b><br>${fmtPct(k / n)} of relays arrive before the owner's next accepted upload` };
    });
    root.innerHTML = header('E4 Delayed relay vs attacker delay D', lede, 'E4') + scenarioSwitch() + timeRuleCallout() + `
      <div class="card">${meta(r)}${scenarioNote()}<h3>A4 relays accepted</h3><p class="sub">Solid lines: total acceptance per policy. Dashed grey: the floor (relays that arrive before the owner's next accepted upload), the same for every policy.</p><div id="e4-chart"></div></div>
      <div class="card"><h3>Before / after split</h3>${table([
        { h: 'W', num: true, f: (x) => x.W }, { h: 'T', f: (x) => tLab(x.T) }, { h: 'D', num: true, f: (x) => fmtDur(x.D) },
        { h: 'Share before', num: true, f: (x) => fmtPct(x.shareBefore) },
        { h: 'Accepted overall', f: (x) => rateCell(x, 'a4_') },
        { h: 'Before owner', f: (x) => rateCell(x, 'before_') },
        { h: 'After owner', f: (x) => rateCell(x, 'after_') },
        { h: 'Rejected: window / time / rate', f: (x) => `${x.rejectedWindow} / ${x.rejectedTime} / ${x.rejectedRateLimit}` },
      ], r.rows)}${notes(r.notes)}</div>`;
    lineChart($('#e4-chart'), {
      height: 340,
      x: { type: 'log', domain: [Ds[0] * 0.7, Ds[Ds.length - 1] * 1.4], ticks: Ds.length > 10 ? Ds.filter((d) => [1, 30, 300, 3600, 86400, 604800, 2592000].includes(d)) : Ds, label: 'attacker delay D (log scale)', fmt: fmtDur },
      y: { type: 'linear', domain: [0, 1], label: 'relays accepted', fmt: (v) => fmtPct(v) },
      series: [
        ...policies.map((p, i) => ({ name: `W = ${p.W}, T = ${tLab(p.T)}`, color: SERIES[i % SERIES.length], points: r.rows.filter((x) => x.W === p.W && x.T === p.T).map((x) => point(x, 'a4_', x.D, `W = ${p.W}, T = ${tLab(p.T)}, D = ${fmtDur(x.D)}`)) })),
        { name: 'floor (before owner)', color: 'var(--neutral)', dash: true, markers: false, points: floor },
      ],
    });
  }

  // ---------- E5 ----------
  // Same formula as src/floor.js (kept in sync; the table values come from the server).
  function floorFormula(D, { owner, channel }) {
    const ex = (t, a, b) => (t <= a ? 0 : t >= b ? t - (a + b) / 2 : ((t - a) * (t - a)) / (2 * (b - a)));
    const [a, b] = channel.baseDelaySeconds, [c, d] = channel.reorderExtraDelaySeconds;
    const steps = 400, h = (d - c) / steps;
    let sum = 0;
    for (let i = 0; i <= steps; i++) sum += (i === 0 || i === steps ? 1 : i % 2 ? 4 : 2) * ex(D - (c + i * h), a, b);
    const eX = (1 - channel.pReorder) * ex(D, a, b) + channel.pReorder * ((sum * h) / 3 / (d - c));
    return Math.exp(-(1 / owner.meanTapGapSeconds) * (1 - channel.pLoss) * eX);
  }
  function renderE5(root) {
    const r = RESULTS.E5;
    const lede = 'The delayed-relay floor is the share of relays that reach the server before the owner\'s next upload; no W or T can reject them. For the steady scenario it has a formula: F(D) = exp(&minus;&lambda; q E[(D &minus; X)<sup>+</sup>]), with &lambda; = taps per second, q = 1 &minus; pLoss and X = upload delay. Dots: simulation with 95% Wilson whiskers. Dashed: formula.';
    if (!r) { root.innerHTML = header('E5 Floor formula', lede, 'E5') + missing('E5'); return; }
    const Ks = [...new Set(r.rows.map((x) => x.tapsPerTrial))];
    const Ds = [...new Set(r.rows.map((x) => x.D))];
    const curve = [];
    const dMin = Ds[0] * 0.7, dMax = Ds[Ds.length - 1] * 1.4;
    const cfgUsed = { owner: { ...r.config.owner, ...(r.config.scenarios?.steady?.owner ?? {}) }, channel: r.config.channel };
    for (let k = 0; k <= 80; k++) { const D = dMin * Math.pow(dMax / dMin, k / 80); curve.push({ x: D, y: floorFormula(D, cfgUsed) }); }
    const series = Ks.map((K, i) => ({
      name: `simulated, ${K} taps per trial`, color: SERIES[i % SERIES.length], line: false,
      points: r.rows.filter((x) => x.tapsPerTrial === K).map((x) => point(x, '', x.D, `${K} taps per trial, D = ${fmtDur(x.D)}`, {
        tip: rateTip(x, '', `${K} taps per trial, D = ${fmtDur(x.D)}`).replace(/^<b>(.*?)<\/b><br>/, '<b>$1</b><br>Relays before owner: ') + `<br>Formula: ${fmtPct(x.formula, 3)} (${x.formulaInsideWilson ? 'inside' : 'OUTSIDE'} the interval)`,
      })),
    }));
    series.push({ name: 'formula F(D)', color: 'var(--neutral)', dash: true, markers: false, points: curve });
    root.innerHTML = header('E5 Delayed-relay floor: formula vs simulation', lede, 'E5') + `
      <div class="card">${meta(r)}<div id="e5-chart"></div></div>
      <div class="card"><h3>Simulated vs formula</h3>${table([
        { h: 'Taps per trial', num: true, f: (x) => x.tapsPerTrial },
        { h: 'D', num: true, f: (x) => fmtDur(x.D) },
        { h: 'Relays before owner [95% Wilson]', f: (x) => rateCell(x) },
        { h: 'Formula', num: true, f: (x) => fmtPct(x.formula, 3) },
        { h: 'Inside?', f: (x) => x.formulaInsideWilson ? '<span class="badge pass">&#10003; yes</span>' : '<span class="badge warn">&#9888; no</span>' },
        { h: 'End effect pLoss/K', num: true, f: (x) => x.endEffectPLossOverK !== undefined ? fmtPct(x.endEffectPLossOverK, 2) : '–' },
        { h: 'Before relays accepted', num: true, f: (x) => `${x.beforeAccepted.toLocaleString()} / ${x.count.toLocaleString()}` },
      ], r.rows)}${notes(r.notes)}</div>`;
    lineChart($('#e5-chart'), {
      height: 340,
      x: { type: 'log', domain: [dMin, dMax], ticks: Ds, label: 'attacker delay D (log scale)', fmt: fmtDur },
      y: { type: 'linear', domain: [0, 1], label: 'relays before next upload', fmt: (v) => fmtPct(v) },
      series,
    });
  }

  // ---------- A1 & A5 ----------
  function renderA1A5(root) {
    const r = RESULTS.A1A5;
    const lede = 'A1: a clone with the same UID but a made-up key. A5: a genuine "open seal" message with the tamper flag changed to "closed". Both run at the default settings.';
    if (!r) { root.innerHTML = header('A1 clone and A5 tamper forgery', lede, 'A1A5') + missing('A1A5'); return; }
    root.innerHTML = header('A1 clone and A5 tamper forgery', lede, 'A1A5') + `<div class="card">${meta(r)}${table([
      { h: 'Attacker', f: (x) => x.attacker },
      { h: 'Accepted', f: (x) => rateCell(x) },
      { h: 'Rejected by MAC', num: true, f: (x) => x.rejected_mac.toLocaleString() },
      { h: 'by rate limit', num: true, f: (x) => x.rejected_rate_limit.toLocaleString() },
      { h: 'by window / time / duplicate', num: true, f: (x) => `${x.rejected_window} / ${x.rejected_time} / ${x.rejected_duplicate}` },
    ], r.rows)}${notes(r.notes)}</div>`;
  }

  // ---------- Assumptions / config ----------
  function collectNotes(obj, path = []) {
    const out = [];
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('_') && typeof v === 'string') out.push({ where: path.join('.') || 'config', text: v });
      else if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...collectNotes(v, [...path, k]));
    }
    return out;
  }
  function renderConfig(root) {
    const list = collectNotes(CONFIG);
    root.innerHTML = header('Assumptions and configuration', 'Every parameter lives in config/default.json. Values marked ASSUMPTION are modeling choices, not measurements. Every saved result also stores the exact config and seed it used.') + `
      <div class="card"><h3>Assumptions and notes</h3>${table([
        { h: 'Where', f: (x) => `<span class="mono">${esc(x.where)}</span>` },
        { h: 'Note', f: (x) => {
          const tag = ['ASSUMPTION', 'DEPLOYMENT REQUIREMENT', 'MODEL SIMPLIFICATION'].find((t) => x.text.startsWith(t) || x.text.includes(`${t}:`) || x.text.includes(`${t} (`));
          return (tag ? `<span class="badge warn">${tag}</span> ` : '') + esc(tag ? x.text.replace(`${tag}: `, '').replace(`${tag} `, '') : x.text);
        } },
      ], list).replace(/white-space: nowrap/g, '')}</div>
      <div class="card"><h3>config/default.json</h3><pre class="config">${esc(JSON.stringify(CONFIG, null, 2))}</pre></div>`;
    root.querySelectorAll('td').forEach((td) => { td.style.whiteSpace = 'normal'; });
  }

  const RENDER = {
    'p-overview': renderOverview, 'p-E0': renderE0, 'p-demo': renderDemo, 'p-trace': renderTrace,
    'p-E1': renderE1, 'p-E2': renderE2, 'p-E3': renderE3, 'p-E4': renderE4, 'p-E5': renderE5, 'p-A1A5': renderA1A5, 'p-config': renderConfig,
  };

  // ---------- running experiments ----------
  async function run(ids) {
    const body = { ids, trialsPerConfig: Number($('#ctl-trials').value) || undefined, seed: Number.isInteger(Number($('#ctl-seed').value)) ? Number($('#ctl-seed').value) : undefined };
    const res = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status === 409) { $('#status-line').textContent = 'A run is already in progress.'; return; }
    poll();
  }
  async function poll() {
    const s = await api('/api/status');
    const btns = document.querySelectorAll('button[data-run], #btn-run-all');
    btns.forEach((b) => { b.disabled = s.running; });
    $('#progress').classList.toggle('on', s.running);
    if (s.running) {
      $('#status-line').textContent = s.id ? `Running ${s.id}: ${s.done} / ${s.total || '?'} configurations…` : 'Starting…';
      $('#progress > div').style.width = s.total ? `${(100 * s.done) / s.total}%` : '0%';
      setTimeout(poll, 500);
    } else {
      $('#status-line').textContent = s.error ? `Error: ${s.error}` : 'Results up to date.';
      RESULTS = await api('/api/results');
      renderPanel(active());
    }
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-run]');
    if (b) run([b.dataset.run]);
  });

  // ---------- theme ----------
  function setupTheme() {
    const rootEl = document.documentElement;
    try { const t = localStorage.getItem('aegis-theme'); if (t) rootEl.dataset.theme = t; } catch (e) { /* ignore */ }
    $('#btn-theme').onclick = () => {
      const dark = rootEl.dataset.theme ? rootEl.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      rootEl.dataset.theme = dark ? 'light' : 'dark';
      try { localStorage.setItem('aegis-theme', rootEl.dataset.theme); } catch (e) { /* ignore */ }
      renderPanel(active());
    };
  }

  // ---------- start ----------
  async function init() {
    setupTheme();
    [CONFIG, RESULTS] = await Promise.all([api('/api/config'), api('/api/results')]);
    $('#ctl-trials').value = CONFIG.trialsPerConfig;
    $('#ctl-seed').value = CONFIG.seed;
    $('#btn-run-all').onclick = () => run(['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'A1A5']);
    setupTabs();
    poll();
  }
  init();
})();
