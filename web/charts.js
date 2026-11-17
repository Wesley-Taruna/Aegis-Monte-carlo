// Tiny SVG chart helpers (no external libraries), so every line can be explained.
// Exposes: Charts.lineChart(el, options), Charts.traceChart(el, trace), Charts.fmtPct(x)
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const tooltip = () => document.getElementById('tooltip');

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function fmtPct(x, digits = 2) {
    if (x === null || x === undefined || Number.isNaN(x)) return '–';
    if (x === 0) return '0%';
    const p = x * 100;
    if (Math.abs(p) >= 10) return p.toFixed(1) + '%';
    if (Math.abs(p) >= 0.01) return p.toPrecision(digits) + '%';
    return p.toExponential(1) + '%';
  }

  function niceTicks(min, max, count = 5) {
    if (max === min) return [min];
    const span = max - min;
    const step0 = Math.pow(10, Math.floor(Math.log10(span / count)));
    const err = (count / span) * step0;
    const step = step0 * (err <= 0.15 ? 10 : err <= 0.35 ? 5 : err <= 0.75 ? 2 : 1);
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(+v.toPrecision(12));
    return ticks;
  }

  function el(tag, attrs = {}, parent) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  }

  function attachTooltip(svg, container) {
    const tip = tooltip();
    svg.addEventListener('mousemove', (e) => {
      const t = e.target.closest('[data-tip]');
      if (!t) { tip.style.display = 'none'; return; }
      tip.innerHTML = t.getAttribute('data-tip');
      tip.style.display = 'block';
      const pad = 14;
      let x = e.pageX + pad, y = e.pageY + pad;
      const w = tip.offsetWidth, h = tip.offsetHeight;
      if (x + w > window.scrollX + document.documentElement.clientWidth - 8) x = e.pageX - w - pad;
      if (y + h > window.scrollY + window.innerHeight - 8) y = e.pageY - h - pad;
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
    });
    svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  }

  function legendHtml(items) {
    return '<div class="legend">' + items.map((s) =>
      `<span><i class="${s.dash ? 'dash' : ''}" style="background:${s.color}"></i>${esc(s.name)}</span>`).join('') + '</div>';
  }

  function makeScale(axis, range, values) {
    const [r0, r1] = range;
    if (axis.type === 'cat') {
      const n = values.length;
      const pos = (v) => r0 + ((values.indexOf(v) + 0.5) * (r1 - r0)) / n;
      return { pos, ticks: values, fmt: axis.fmt || String };
    }
    const [d0, d1] = axis.domain;
    if (axis.type === 'log') {
      const l0 = Math.log10(d0), l1 = Math.log10(d1);
      const pos = (v) => r0 + ((Math.log10(Math.max(v, d0)) - l0) / (l1 - l0)) * (r1 - r0);
      const ticks = axis.ticks || (() => { const t = []; for (let e = Math.ceil(l0); e <= Math.floor(l1); e++) t.push(Math.pow(10, e)); return t; })();
      return { pos, ticks, fmt: axis.fmt || ((v) => v >= 1 ? String(v) : v.toExponential(0)) };
    }
    const pos = (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
    return { pos, ticks: axis.ticks || niceTicks(d0, d1, axis.tickCount || 5), fmt: axis.fmt || String };
  }

  /**
   * options: { height, x: {type, values|domain, label, fmt}, y: {type, domain, label, fmt},
   *            series: [{ name, color, dash, points: [{ x, y, lo, hi, upper, tip, label }] }] }
   * A point with y = 0 on a log y axis and an `upper` value is drawn as a
   * downward triangle at its 95% upper bound (3/N).
   */
  function lineChart(container, o) {
    container.innerHTML = (o.legend === false ? '' : legendHtml(o.series)) + '<div class="chart"></div>';
    const host = container.querySelector('.chart');
    const draw = () => {
      host.innerHTML = '';
      const W = Math.max(320, host.clientWidth || 640), H = o.height || 300;
      const m = { l: 62, r: 18, t: 12, b: 46 };
      const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.ariaLabel || '' }, host);
      const xs = makeScale(o.x, [m.l, W - m.r], o.x.values);
      const ys = makeScale(o.y, [H - m.b, m.t]);

      const grid = el('g', { class: 'grid' }, svg);
      for (const t of ys.ticks) {
        const y = ys.pos(t);
        el('line', { x1: m.l, x2: W - m.r, y1: y, y2: y }, grid);
        el('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end' }, svg).textContent = ys.fmt(t);
      }
      for (const t of xs.ticks) {
        const x = xs.pos(t);
        el('text', { x, y: H - m.b + 18, 'text-anchor': 'middle' }, svg).textContent = xs.fmt(t);
      }
      el('line', { class: 'baseline', x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b }, svg);
      if (o.x.label) el('text', { class: 'axis-label', x: m.l + (W - m.l - m.r) / 2, y: H - 6, 'text-anchor': 'middle' }, svg).textContent = o.x.label;
      if (o.y.label) el('text', { class: 'axis-label', x: 14, y: m.t + (H - m.t - m.b) / 2, 'text-anchor': 'middle', transform: `rotate(-90 14 ${m.t + (H - m.t - m.b) / 2})` }, svg).textContent = o.y.label;

      const isLogY = o.y.type === 'log';
      const placed = []; // label boxes already drawn
      const drawable = (p) => p.y !== null && p.y !== undefined && !(isLogY && p.y <= 0);

      for (const s of o.series) {
        const pts = s.points.filter(drawable);
        if (pts.length > 1 && s.line !== false) {
          const d = pts.map((p, i) => `${i ? 'L' : 'M'}${xs.pos(p.x).toFixed(1)},${ys.pos(p.y).toFixed(1)}`).join('');
          el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-dasharray': s.dash ? '5 4' : null, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
        }
        for (const p of s.points) {
          const x = xs.pos(p.x);
          if (p.lo !== undefined && p.hi !== undefined && p.hi !== null) {
            const lo = isLogY ? Math.max(p.lo, o.y.domain[0]) : p.lo;
            const y1 = ys.pos(lo), y2 = ys.pos(p.hi);
            el('line', { x1: x, x2: x, y1, y2, stroke: s.color, 'stroke-width': 1.5, opacity: 0.55 }, svg);
            el('line', { x1: x - 3, x2: x + 3, y1: y2, y2: y2, stroke: s.color, 'stroke-width': 1.5, opacity: 0.55 }, svg);
            if (!(isLogY && p.lo <= 0)) el('line', { x1: x - 3, x2: x + 3, y1, y2: y1, stroke: s.color, 'stroke-width': 1.5, opacity: 0.55 }, svg);
          }
          if (drawable(p)) {
            if (s.markers !== false) el('circle', { cx: x, cy: ys.pos(p.y), r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2 }, svg);
            if (p.label) {
              // Skip a label if it would overlap one already drawn.
              const lx = x + 7, ly = ys.pos(p.y) - 7, w = 6.5 * p.label.length + 2;
              if (!placed.some((b) => lx < b.x + b.w && lx + w > b.x && Math.abs(ly - b.y) < 12)) {
                placed.push({ x: lx, y: ly, w });
                el('text', { x: lx, y: ly, 'font-size': 10 }, svg).textContent = p.label;
              }
            }
          } else if (isLogY && p.upper) {
            const y = ys.pos(p.upper);
            el('path', { d: `M${x - 5},${y - 4}L${x + 5},${y - 4}L${x},${y + 4}Z`, fill: 'none', stroke: s.color, 'stroke-width': 1.5 }, svg);
          }
          if (p.tip) {
            const cy = drawable(p) ? ys.pos(p.y) : p.upper ? ys.pos(p.upper) : H - m.b;
            el('circle', { cx: x, cy, r: 12, fill: 'transparent', 'data-tip': p.tip }, svg);
          }
        }
      }
      attachTooltip(svg, host);
    };
    draw();
    let last = host.clientWidth;
    new ResizeObserver(() => { if (Math.abs(host.clientWidth - last) > 4) { last = host.clientWidth; draw(); } }).observe(host);
  }

  // 75.3 -> "75.3 s"; 200000 -> "day 2, 07:33:20"
  function fmtT(t) {
    if (t < 86400) return `${t.toFixed(1)} s`;
    const d = Math.floor(t / 86400), r = t - d * 86400;
    const hh = String(Math.floor(r / 3600)).padStart(2, '0'), mm = String(Math.floor((r % 3600) / 60)).padStart(2, '0'), ss = String(Math.floor(r % 60)).padStart(2, '0');
    return `day ${d}, ${hh}:${mm}:${ss}`;
  }

  // One trial as a timeline: x = time (s), y = counter value.
  function traceChart(container, tr) {
    const series = [
      { name: 'Owner upload accepted', color: 'var(--s1)' },
      { name: 'Owner upload rejected', color: 'var(--critical)' },
      { name: 'Upload lost (never arrives)', color: 'var(--neutral)' },
      { name: 'Attacker message', color: 'var(--s2)' },
    ];
    container.innerHTML = legendHtml(series) + '<div class="chart"></div>';
    const host = container.querySelector('.chart');
    const draw = () => {
      host.innerHTML = '';
      const W = Math.max(320, host.clientWidth || 640), H = 340;
      const m = { l: 54, r: 18, t: 12, b: 44 };
      const svg = el('svg', { viewBox: `0 0 ${W} ${H}` }, host);
      // Long quiet periods (gold scenario: days between sales) are squeezed to a
      // fixed width so each burst of taps stays readable; a dashed line marks each cut.
      const GAP = 3600, KEEP = 900;
      const allT = [0, ...tr.taps.map((t) => t.time), ...tr.log.map((e) => e.time), ...tr.log.map((e) => e.createdAt ?? e.time)].sort((a, b) => a - b);
      const cuts = [];
      for (let i = 1; i < allT.length; i++) if (allT[i] - allT[i - 1] > GAP) cuts.push({ start: allT[i - 1], end: allT[i] });
      const squeeze = (t) => {
        let s = 0;
        for (const c of cuts) {
          if (t >= c.end) s += c.end - c.start - KEEP;
          else if (t > c.start) s += Math.max(0, t - c.start - KEEP);
        }
        return t - s;
      };
      const tMax = squeeze(Math.max(1, ...allT)) * 1.03;
      const cMax = Math.max(2, ...tr.taps.map((t) => t.counter), ...tr.log.map((e) => e.counter)) + 1;
      const lin = makeScale({ type: 'linear', domain: [0, tMax] }, [m.l, W - m.r]);
      const xs = { pos: (t) => lin.pos(squeeze(t)) };
      const ys = makeScale({ type: 'linear', domain: [0, cMax] }, [H - m.b, m.t]);
      const grid = el('g', { class: 'grid' }, svg);
      for (const t of ys.ticks) { el('line', { x1: m.l, x2: W - m.r, y1: ys.pos(t), y2: ys.pos(t) }, grid); el('text', { x: m.l - 8, y: ys.pos(t) + 4, 'text-anchor': 'end' }, svg).textContent = t; }
      if (!cuts.length) {
        for (const t of lin.ticks) el('text', { x: lin.pos(t), y: H - m.b + 18, 'text-anchor': 'middle' }, svg).textContent = t;
      } else {
        for (const c of cuts) {
          const x = xs.pos(c.start + KEEP / 2);
          el('line', { x1: x, x2: x, y1: m.t, y2: H - m.b, stroke: 'var(--text-3)', 'stroke-dasharray': '2 4' }, svg);
          const days = (c.end - c.start) / 86400;
          el('text', { x, y: H - m.b + 18, 'text-anchor': 'middle' }, svg).textContent = days >= 1 ? `≈${days.toFixed(1)} d` : `≈${((c.end - c.start) / 3600).toFixed(1)} h`;
        }
      }
      el('line', { class: 'baseline', x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b }, svg);
      el('text', { class: 'axis-label', x: m.l + (W - m.l - m.r) / 2, y: H - 6, 'text-anchor': 'middle' }, svg).textContent = cuts.length
        ? 'time on the server clock (quiet periods squeezed; labels show their real length)'
        : 'time (seconds, server clock)';
      el('text', { class: 'axis-label', x: 14, y: H / 2, 'text-anchor': 'middle', transform: `rotate(-90 14 ${H / 2})` }, svg).textContent = 'counter value';

      // Delay lines: from tap time to server arrival.
      const created = new Map(tr.taps.map((t) => [t.counter, t]));
      for (const e of tr.log) {
        const tap = created.get(e.counter);
        const t0 = e.isAttack ? e.createdAt : tap ? tap.time : e.time;
        el('line', { x1: xs.pos(t0), x2: xs.pos(e.time), y1: ys.pos(e.counter), y2: ys.pos(e.counter), stroke: e.isAttack ? 'var(--s2)' : 'var(--neutral)', 'stroke-width': 1.5, opacity: 0.6, 'stroke-dasharray': e.isAttack ? '4 3' : null }, svg);
      }
      for (const t of tr.taps.filter((t) => t.lost)) {
        el('circle', { cx: xs.pos(t.time), cy: ys.pos(t.counter), r: 4.5, fill: 'var(--surface)', stroke: 'var(--neutral)', 'stroke-width': 1.5, 'data-tip': `<b>Counter ${t.counter}</b><br>Owner tap at ${fmtT(t.time)}<br>Upload LOST - never reaches the server` }, svg);
      }
      for (const e of tr.log) {
        const x = xs.pos(e.time), y = ys.pos(e.counter);
        const ok = e.result.outcome !== 'rejected';
        const verdict = ok ? e.result.outcome.toUpperCase() : `REJECTED (${e.result.rule})`;
        const who = e.isAttack ? `Attacker ${e.attackType}` : 'Owner';
        const extra = e.isAttack && e.attackType === 'A4' ? `<br>Arrived ${e.ownerAheadAtArrival ? 'AFTER' : 'BEFORE'} the owner's next accepted upload` : '';
        const tip = `<b>${who} &middot; counter ${e.counter}</b><br>Arrived at ${fmtT(e.time)}${e.reordered ? ' (reordered)' : ''}<br>Server verdict: <b>${verdict}</b>${extra}`;
        if (e.isAttack) {
          const r = 6;
          el('path', { d: `M${x},${y - r}L${x + r},${y}L${x},${y + r}L${x - r},${y}Z`, fill: ok ? 'var(--s2)' : 'var(--surface)', stroke: 'var(--s2)', 'stroke-width': 2 }, svg);
        } else if (ok) {
          el('circle', { cx: x, cy: y, r: 4.5, fill: 'var(--s1)', stroke: 'var(--surface)', 'stroke-width': 2 }, svg);
        } else {
          el('path', { d: `M${x - 4},${y - 4}L${x + 4},${y + 4}M${x + 4},${y - 4}L${x - 4},${y + 4}`, stroke: 'var(--critical)', 'stroke-width': 2.2, 'stroke-linecap': 'round' }, svg);
        }
        el('circle', { cx: x, cy: y, r: 11, fill: 'transparent', 'data-tip': tip }, svg);
      }
      attachTooltip(svg, host);
    };
    draw();
    let last = host.clientWidth;
    new ResizeObserver(() => { if (Math.abs(host.clientWidth - last) > 4) { last = host.clientWidth; draw(); } }).observe(host);
  }

  window.Charts = { lineChart, traceChart, fmtPct, fmtT, esc };
})();
