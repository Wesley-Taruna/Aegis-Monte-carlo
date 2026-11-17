"""Make PNG figures for the paper from results/*.csv.

Run:  python3 plots/make_plots.py      (needs matplotlib)
Reads only the CSV files written by `node src/run-all.js`; never re-simulates.
"""
import csv
import math
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS = os.path.join(HERE, "..", "results")
COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]
NEUTRAL = "#8a8984"

plt.rcParams.update({
    "font.size": 9, "axes.spines.top": False, "axes.spines.right": False,
    "axes.grid": True, "grid.color": "#e8e6e0", "grid.linewidth": 0.8,
    "axes.edgecolor": "#7a7973", "legend.frameon": False, "figure.dpi": 200,
})


def read(name):
    path = os.path.join(RESULTS, name)
    if not os.path.exists(path):
        return None
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        for k, v in r.items():
            try:
                r[k] = float(v)
            except (TypeError, ValueError):
                pass
    return rows


def errbars(rows, prefix):
    y = [r[prefix + "rate"] for r in rows]
    lo = [r[prefix + "rate"] - r[prefix + "wilsonLow"] for r in rows]
    hi = [r[prefix + "wilsonHigh"] - r[prefix + "rate"] for r in rows]
    return y, [lo, hi]


def save(fig, name):
    fig.tight_layout()
    out = os.path.join(HERE, name)
    fig.savefig(out)
    plt.close(fig)
    print("wrote", os.path.relpath(out))


def plot_e1():
    rows = read("E1.csv")
    if not rows:
        return
    fig, ax = plt.subplots(figsize=(4.2, 3.0))
    for i, b in enumerate(sorted({r["macBits"] for r in rows})):
        sub = [r for r in rows if r["macBits"] == b]
        ns = [r["attempts"] for r in sub]
        y, err = errbars(sub, "")
        pos = [(n, v, e0, e1) for n, v, e0, e1 in zip(ns, y, *err) if v > 0]
        if pos:
            ax.errorbar([p[0] for p in pos], [p[1] for p in pos], yerr=[[min(p[2], p[1] * 0.999) for p in pos], [p[3] for p in pos]],
                        fmt="o", ms=4, color=COLORS[i], capsize=2, label=f"b = {int(b)} simulated")
        zeros = [r for r in sub if r["rate"] == 0]
        if zeros:
            ax.plot([r["attempts"] for r in zeros], [r["upper3N"] for r in zeros], "v", mfc="none", color=COLORS[i])
        grid = [ns[0] * (ns[-1] / ns[0]) ** (k / 50) for k in range(51)]
        ax.plot(grid, [-math.expm1(n * math.log1p(-2.0 ** -b)) for n in grid], "--", color=COLORS[i], lw=1.2)
    ax.plot([], [], "--", color=NEUTRAL, label="formula 1-(1-2^-b)^n")
    ax.set(xscale="log", yscale="log", xlabel="guesses n", ylabel="P(success)", ylim=(1e-5, 1.5))
    ax.legend(fontsize=7)
    save(fig, "E1_guessing.png")


def tlabel(t):
    return "off" if t == "off" else t.replace("s", " s")


def scenario_rows(rows, scenario):
    """Rows of one owner scenario (older CSVs without the column count as steady)."""
    return [r for r in rows if r.get("scenario", "steady") in (scenario, "")]


SCENARIOS = [("steady", ""), ("gold", "_gold")]


def fmt_dur(s):
    for unit, n in (("d", 86400), ("h", 3600)):
        if s >= n and s % n == 0:
            return f"{int(s // n)} {unit}"
    return f"{int(s)} s"


def plot_e2():
    for scenario, suffix in SCENARIOS:
        plot_e2_one(scenario, suffix)


def plot_e2_one(scenario, suffix):
    rows = read("E2.csv")
    if not rows:
        return
    rows = scenario_rows(rows, scenario)
    if not rows:
        return
    Ts = list(dict.fromkeys(r["T"] for r in rows))
    Ws = sorted({r["W"] for r in rows})
    xi = {w: i for i, w in enumerate(Ws)}
    fig, axes = plt.subplots(1, 2, figsize=(7.4, 2.9))
    for i, T in enumerate(Ts):
        sub = sorted([r for r in rows if r["T"] == T], key=lambda r: r["W"])
        x = [xi[r["W"]] for r in sub]
        y, err = errbars(sub, "frr_")
        axes[0].errorbar(x, [v * 100 for v in y], yerr=[[e * 100 for e in err[0]], [e * 100 for e in err[1]]], marker="o", ms=3, lw=1.5, capsize=2, color=COLORS[i], label=f"T = {tlabel(T)}")
        y, err = errbars(sub, "a4_")
        axes[1].errorbar(x, [v * 100 for v in y], yerr=[[e * 100 for e in err[0]], [e * 100 for e in err[1]]], marker="o", ms=3, lw=1.5, capsize=2, color=COLORS[i], label=f"T = {tlabel(T)}")
    floor = [100 * sum(r["a4before_count"] for r in rows if r["W"] == w) / sum(r["a4_N"] for r in rows if r["W"] == w) for w in Ws]
    axes[1].plot(range(len(Ws)), floor, "--", color=NEUTRAL, label="floor (before owner)")
    for ax in axes:
        ax.set_xticks(range(len(Ws)), [str(int(w)) for w in Ws])
        ax.set_xlabel("backward window W")
    axes[0].set_ylabel("honest false-reject rate (%)")
    axes[1].set_ylabel("A4 relays accepted (%)")
    axes[1].set_ylim(0, 102)
    axes[0].legend(fontsize=7)
    axes[1].legend(fontsize=7, loc="lower right")
    save(fig, f"E2_window_sweep{suffix}.png")


def plot_e3():
    for scenario, suffix in SCENARIOS:
        plot_e3_one(scenario, suffix)


def plot_e3_one(scenario, suffix):
    rows = read("E3.csv")
    if not rows:
        return
    rows = scenario_rows(rows, scenario)
    if not rows:
        return
    policies = list(dict.fromkeys((r["W"], r["T"]) for r in rows))
    losses = sorted({r["pLoss"] for r in rows})
    reorders = sorted({r["pReorder"] for r in rows})
    vmax = max(r["frr_rate"] for r in rows) * 100 or 1
    fig, axes = plt.subplots(1, len(policies), figsize=(2.6 * len(policies), 2.6))
    for ax, (W, T) in zip(axes, policies):
        grid = [[next(r["frr_rate"] * 100 for r in rows if r["W"] == W and r["T"] == T and r["pLoss"] == l and r["pReorder"] == q) for q in reorders] for l in losses]
        im = ax.imshow(grid, cmap="Blues", vmin=0, vmax=vmax, origin="lower")
        for a, l in enumerate(losses):
            for b, q in enumerate(reorders):
                v = grid[a][b]
                ax.text(b, a, f"{v:.2g}", ha="center", va="center", fontsize=7, color="white" if v > vmax * 0.5 else "black")
        ax.set_xticks(range(len(reorders)), [f"{q:g}" for q in reorders])
        ax.set_yticks(range(len(losses)), [f"{l:g}" for l in losses])
        ax.set(xlabel="pReorder", ylabel="pLoss", title=f"W = {int(W)}, T = {tlabel(T)}")
        ax.grid(False)
    fig.colorbar(im, ax=axes, shrink=0.8, label="honest false rejects (%)")
    out = os.path.join(HERE, f"E3_sensitivity{suffix}.png")
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    print("wrote", os.path.relpath(out))


def plot_e4():
    for scenario, suffix in SCENARIOS:
        plot_e4_one(scenario, suffix)


def plot_e4_one(scenario, suffix):
    rows = read("E4.csv")
    if not rows:
        return
    rows = scenario_rows(rows, scenario)
    if not rows:
        return
    policies = list(dict.fromkeys((r["W"], r["T"]) for r in rows))
    Ds = sorted({r["D"] for r in rows})
    fig, ax = plt.subplots(figsize=(4.4, 3.0))
    for i, (W, T) in enumerate(policies):
        sub = sorted([r for r in rows if r["W"] == W and r["T"] == T], key=lambda r: r["D"])
        y, err = errbars(sub, "a4_")
        ax.errorbar([r["D"] for r in sub], [v * 100 for v in y], yerr=[[e * 100 for e in err[0]], [e * 100 for e in err[1]]], marker="o", ms=3, lw=1.5, capsize=2, color=COLORS[i], label=f"W = {int(W)}, T = {tlabel(T)}")
    floor = [100 * sum(r["before_count"] for r in rows if r["D"] == d) / sum(r["a4_N"] for r in rows if r["D"] == d) for d in Ds]
    ax.plot(Ds, floor, "--", color=NEUTRAL, label="floor (before owner)")
    ax.set(xscale="log", xlabel="attacker delay D", ylabel="A4 relays accepted (%)", ylim=(0, 102))
    ticks = [d for d in Ds if d in (1, 30, 300, 3600, 86400, 604800, 2592000)] if len(Ds) > 10 else Ds
    ax.set_xticks(ticks, [fmt_dur(d) for d in ticks])
    ax.legend(fontsize=7)
    save(fig, f"E4_delayed_relay{suffix}.png")


def floor_formula(D, cfg):
    """F(D) = exp(-lambda * q * E[(D - X)+]); see src/floor.js for the derivation."""
    owner = {**cfg["owner"], **cfg.get("scenarios", {}).get("steady", {}).get("owner", {})}
    ch = cfg["channel"]
    a, b = ch["baseDelaySeconds"]
    c, d = ch["reorderExtraDelaySeconds"]

    def ex(t):
        return 0.0 if t <= a else (t - (a + b) / 2 if t >= b else (t - a) ** 2 / (2 * (b - a)))

    steps = 400
    h = (d - c) / steps
    simpson = sum((1 if i in (0, steps) else (4 if i % 2 else 2)) * ex(D - (c + i * h)) for i in range(steps + 1)) * h / 3
    e_x = (1 - ch["pReorder"]) * ex(D) + ch["pReorder"] * simpson / (d - c)
    return math.exp(-(1 / owner["meanTapGapSeconds"]) * (1 - ch["pLoss"]) * e_x)


def plot_e5():
    rows = read("E5.csv")
    if not rows:
        return
    fig, ax = plt.subplots(figsize=(4.4, 3.0))
    Ks = sorted({r["tapsPerTrial"] for r in rows})
    for i, K in enumerate(Ks):
        sub = sorted([r for r in rows if r["tapsPerTrial"] == K], key=lambda r: r["D"])
        y, err = errbars(sub, "")
        ax.errorbar([r["D"] for r in sub], [v * 100 for v in y], yerr=[[e * 100 for e in err[0]], [e * 100 for e in err[1]]],
                    fmt="o", ms=3.5, capsize=2, color=COLORS[i], label=f"simulated, {int(K)} taps/trial")
    # Smooth formula curve from the exact config the run used (same formula as src/floor.js).
    import json
    with open(os.path.join(RESULTS, "E5.config-used.json")) as f:
        cfg = json.load(f)["config"]
    Ds = sorted({r["D"] for r in rows})
    grid = [Ds[0] * 0.7 * (Ds[-1] * 1.4 / (Ds[0] * 0.7)) ** (k / 120) for k in range(121)]
    ax.plot(grid, [floor_formula(D, cfg) * 100 for D in grid], "--", color=NEUTRAL, lw=1.4, label="formula exp(-λq E[(D-X)+])")
    ax.set(xscale="log", xlabel="attacker delay D (s)", ylabel="relays before owner's next upload (%)", ylim=(0, 102))
    ax.legend(fontsize=7)
    save(fig, "E5_floor_formula.png")


if __name__ == "__main__":
    plot_e1()
    plot_e2()
    plot_e3()
    plot_e4()
    plot_e5()
