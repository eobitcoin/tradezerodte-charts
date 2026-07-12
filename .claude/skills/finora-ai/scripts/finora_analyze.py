#!/usr/bin/env python3
"""
Finora.AI analysis engine.

Pulls live OHLCV bars from Polygon for a ticker on two timeframes (a higher
timeframe for trend + Smart-Money levels, a lower timeframe for the tactical
indicator suite + entries), computes a full technical + SMC picture, and emits
a single JSON object. The SKILL.md narrates that JSON into the Finora report —
so every number in the report is COMPUTED, never invented.

Usage:
    POLYGON_API_KEY=... python finora_analyze.py TSLA
    python finora_analyze.py TSLA --htf day --ltf hour
    python finora_analyze.py SPY --ltf 15min

Timeframe tokens: "15min", "30min", "hour", "4hour", "day", "week".
Only numpy / pandas / requests are required (no TA library).
"""
from __future__ import annotations
import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import requests

POLYGON_BASE = "https://api.polygon.io"

# token -> (multiplier, timespan, calendar-days of history to pull)
TF = {
    "15min": (15, "minute", 30),
    "30min": (30, "minute", 45),
    "hour": (1, "hour", 90),
    "4hour": (4, "hour", 240),
    "day": (1, "day", 500),
    "week": (1, "week", 1500),
}


# --------------------------------------------------------------------------- #
# Data
# --------------------------------------------------------------------------- #
def _polygon_key() -> str:
    key = os.environ.get("POLYGON_API_KEY")
    if not key:
        sys.exit("ERROR: POLYGON_API_KEY not set in the environment.")
    return key


def fetch_bars(ticker: str, tf: str) -> pd.DataFrame:
    """Fetch bars NEWEST-FIRST with pagination, then reverse to ascending.

    Why sort=desc + next_url: Polygon's aggs `limit` counts BASE (minute)
    aggregates, not output bars — a 90-day hourly request needs ~86k minute
    bars vs the 50k cap, and with sort=asc Polygon silently keeps the OLDEST
    bars and drops the newest. That once produced a two-week-stale "current
    price". Descending sort guarantees the freshest bars arrive first even if
    truncation hits; pagination then back-fills history for indicator warmup.
    """
    key = _polygon_key()
    mult, span, days = TF[tf]
    to = datetime.now(timezone.utc).date()
    frm = to - timedelta(days=days)
    url = (
        f"{POLYGON_BASE}/v2/aggs/ticker/{ticker.upper()}/range/{mult}/{span}/"
        f"{frm}/{to}?adjusted=true&sort=desc&limit=50000&apiKey={key}"
    )
    res: list = []
    pages = 0
    while url and pages < 5 and len(res) < 3000:  # plenty for a 50-bar warmup
        r = requests.get(url, timeout=30)
        r.raise_for_status()
        body = r.json()
        res.extend(body.get("results") or [])
        nxt = body.get("next_url")
        url = f"{nxt}&apiKey={key}" if nxt else None
        pages += 1
    if not res:
        sys.exit(f"ERROR: no {tf} bars returned for {ticker}.")
    df = pd.DataFrame(res).rename(
        columns={"o": "open", "h": "high", "l": "low", "c": "close", "v": "volume", "t": "ts"}
    )
    df["dt"] = pd.to_datetime(df["ts"], unit="ms", utc=True)
    df = df.sort_values("dt").drop_duplicates(subset="ts")
    return df[["dt", "open", "high", "low", "close", "volume"]].reset_index(drop=True)


def fetch_snapshot_price(ticker: str) -> dict:
    """Authoritative current price from Polygon's snapshot (last trade +
    prev-day close). Used to cross-check the bar series — bars can silently
    truncate/staleness-drift; the snapshot cannot."""
    key = _polygon_key()
    url = f"{POLYGON_BASE}/v2/snapshot/locale/us/markets/stocks/tickers/{ticker.upper()}?apiKey={key}"
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    t = (r.json().get("ticker") or {})
    last = (t.get("lastTrade") or {}).get("p")
    day_close = (t.get("day") or {}).get("c")
    prev_close = (t.get("prevDay") or {}).get("c")
    price = last or day_close or prev_close
    return {"price": float(price) if price else None, "prev_close": prev_close}


# --------------------------------------------------------------------------- #
# Indicator primitives
# --------------------------------------------------------------------------- #
def ema(s, n):
    return s.ewm(span=n, adjust=False).mean()


def rma(s, n):  # Wilder's smoothing
    return s.ewm(alpha=1 / n, adjust=False).mean()


def true_range(df):
    pc = df["close"].shift(1)
    return pd.concat(
        [df["high"] - df["low"], (df["high"] - pc).abs(), (df["low"] - pc).abs()], axis=1
    ).max(axis=1)


def atr(df, n=14):
    return rma(true_range(df), n)


def rsi(close, n=14):
    d = close.diff()
    up = rma(d.clip(lower=0), n)
    dn = rma(-d.clip(upper=0), n)
    rs = up / dn.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(50)


def macd(close, fast=12, slow=26, sig=9):
    line = ema(close, fast) - ema(close, slow)
    signal = ema(line, sig)
    return line, signal, line - signal


def stochastic(df, k=14, d=3):
    ll = df["low"].rolling(k).min()
    hh = df["high"].rolling(k).max()
    kfast = 100 * (df["close"] - ll) / (hh - ll).replace(0, np.nan)
    kslow = kfast.rolling(d).mean()
    return kslow, kslow.rolling(d).mean()


def adx_dmi(df, n=14):
    up = df["high"].diff()
    dn = -df["low"].diff()
    plus_dm = np.where((up > dn) & (up > 0), up, 0.0)
    minus_dm = np.where((dn > up) & (dn > 0), dn, 0.0)
    tr = rma(true_range(df), n)
    plus_di = 100 * rma(pd.Series(plus_dm, index=df.index), n) / tr.replace(0, np.nan)
    minus_di = 100 * rma(pd.Series(minus_dm, index=df.index), n) / tr.replace(0, np.nan)
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    return rma(dx, n), plus_di, minus_di


def vortex(df, n=14):
    tr = true_range(df)
    vip = (df["high"] - df["low"].shift(1)).abs()
    vim = (df["low"] - df["high"].shift(1)).abs()
    return vip.rolling(n).sum() / tr.rolling(n).sum(), vim.rolling(n).sum() / tr.rolling(n).sum()


def psar(df, af0=0.02, af_step=0.02, af_max=0.2):
    high, low = df["high"].values, df["low"].values
    n = len(df)
    sar = np.full(n, np.nan)
    bull = True
    af = af0
    ep = high[0]
    sar[0] = low[0]
    for i in range(1, n):
        prev = sar[i - 1]
        sar[i] = prev + af * (ep - prev)
        if bull:
            sar[i] = min(sar[i], low[i - 1], low[max(i - 2, 0)])
            if low[i] < sar[i]:
                bull = False
                sar[i] = ep
                ep = low[i]
                af = af0
            elif high[i] > ep:
                ep = high[i]
                af = min(af + af_step, af_max)
        else:
            sar[i] = max(sar[i], high[i - 1], high[max(i - 2, 0)])
            if high[i] > sar[i]:
                bull = True
                sar[i] = ep
                ep = high[i]
                af = af0
            elif low[i] < ep:
                ep = low[i]
                af = min(af + af_step, af_max)
    return pd.Series(sar, index=df.index)


def mfi(df, n=14):
    tp = (df["high"] + df["low"] + df["close"]) / 3
    rmf = tp * df["volume"]
    pos = rmf.where(tp > tp.shift(1), 0.0).rolling(n).sum()
    neg = rmf.where(tp < tp.shift(1), 0.0).rolling(n).sum()
    return 100 - 100 / (1 + pos / neg.replace(0, np.nan))


def fisher(df, n=9):
    med = (df["high"] + df["low"]) / 2
    ll = med.rolling(n).min()
    hh = med.rolling(n).max()
    v = pd.Series(0.0, index=df.index)
    fish = pd.Series(0.0, index=df.index)
    raw = 2 * ((med - ll) / (hh - ll).replace(0, np.nan) - 0.5)
    raw = raw.fillna(0.0)
    for i in range(1, len(df)):
        v.iloc[i] = 0.66 * raw.iloc[i] + 0.67 * v.iloc[i - 1]
        v.iloc[i] = min(max(v.iloc[i], -0.999), 0.999)
        fish.iloc[i] = 0.5 * np.log((1 + v.iloc[i]) / (1 - v.iloc[i])) + 0.5 * fish.iloc[i - 1]
    return fish, fish.shift(1)


# --------------------------------------------------------------------------- #
# Indicator suite -> bull / bear / neutral verdicts (on the entry timeframe)
# --------------------------------------------------------------------------- #
def indicator_verdicts(df):
    close = df["close"]
    out = {}

    ml, ms, mh = macd(close)
    out["MACD"] = _v(ml.iloc[-1] > ms.iloc[-1], f"line {ml.iloc[-1]:.2f} vs signal {ms.iloc[-1]:.2f}")

    vip, vim = vortex(df)
    out["Vortex"] = _v(vip.iloc[-1] > vim.iloc[-1], f"VI+ {vip.iloc[-1]:.2f} / VI- {vim.iloc[-1]:.2f}")

    ps = psar(df)
    out["PSAR"] = _v(close.iloc[-1] > ps.iloc[-1], f"price {close.iloc[-1]:.2f} vs SAR {ps.iloc[-1]:.2f}")

    adx, pdi, mdi = adx_dmi(df)
    out["DMI"] = _v(pdi.iloc[-1] > mdi.iloc[-1], f"+DI {pdi.iloc[-1]:.1f} / -DI {mdi.iloc[-1]:.1f}")

    kk, dd = stochastic(df)
    out["Stochastic"] = _v(kk.iloc[-1] > dd.iloc[-1], f"%K {kk.iloc[-1]:.1f} vs %D {dd.iloc[-1]:.1f}")

    mom = close - close.shift(10)
    out["Momentum"] = _v(mom.iloc[-1] > 0, f"{mom.iloc[-1]:+.2f} over 10 bars")

    rs = rsi(close)
    out["RSI"] = _v(rs.iloc[-1] >= 50, f"{rs.iloc[-1]:.1f}")

    mf = mfi(df)
    out["MFI"] = _v(mf.iloc[-1] >= 50, f"{mf.iloc[-1]:.1f}")

    fh, fs = fisher(df)
    out["Fisher"] = _v(fh.iloc[-1] > fs.iloc[-1], f"{fh.iloc[-1]:.2f} vs prior {fs.iloc[-1]:.2f}")

    adx_v = float(adx.iloc[-1])
    out["ADX"] = {
        "verdict": "strong" if adx_v >= 25 else ("weak" if adx_v < 20 else "moderate"),
        "value": round(adx_v, 1),
        "detail": f"ADX {adx_v:.1f} — {'trending' if adx_v >= 25 else 'range-bound / choppy' if adx_v < 20 else 'developing'}",
    }
    return out


def _v(is_bull, detail):
    return {"verdict": "bullish" if is_bull else "bearish", "detail": detail}


# --------------------------------------------------------------------------- #
# Smart-Money levels (on the higher timeframe)
# --------------------------------------------------------------------------- #
def pivots(df, left=3, right=3):
    highs, lows = [], []
    h, l = df["high"].values, df["low"].values
    for i in range(left, len(df) - right):
        win_h = h[i - left : i + right + 1]
        win_l = l[i - left : i + right + 1]
        if h[i] == win_h.max() and (h[i] > win_h).sum() >= 1:
            highs.append((i, float(h[i])))
        if l[i] == win_l.min() and (l[i] < win_l).sum() >= 1:
            lows.append((i, float(l[i])))
    return highs, lows


def round_levels(price, span=0.12):
    out = set()
    lo, hi = price * (1 - span), price * (1 + span)
    for step in (5, 10, 25):
        x = np.floor(lo / step) * step
        while x <= hi:
            if lo <= x <= hi:
                out.add(round(float(x), 2))
            x += step
    return out


def dedup(levels, tol=0.004):
    levels = sorted(levels)
    kept = []
    for lv in levels:
        if not kept or abs(lv - kept[-1]) / max(lv, 1) > tol:
            kept.append(round(lv, 2))
    return kept


def levels_block(hdf, price):
    ph, pl = pivots(hdf)
    swing_high = ph[-1][1] if ph else float(hdf["high"].tail(40).max())
    swing_low = pl[-1][1] if pl else float(hdf["low"].tail(40).min())
    equilibrium = round((swing_high + swing_low) / 2, 2)

    piv_prices = [p for _, p in ph] + [p for _, p in pl]
    candidates = set(round(p, 2) for p in piv_prices) | round_levels(price)

    resistance = dedup([lv for lv in candidates if lv > price * 1.0008])
    support = dedup([lv for lv in candidates if lv < price * 0.9992])
    resistance = resistance[:6]
    support = sorted(support, reverse=True)[:6]

    # Clusters: >=2 pivots within ~1.2%, restricted to zones near current price
    # (distant historical clusters aren't actionable for this setup).
    piv_sorted = sorted(p for p in piv_prices if abs(p - price) / price <= 0.15)
    clusters = []
    i = 0
    while i < len(piv_sorted):
        grp = [piv_sorted[i]]
        j = i + 1
        while j < len(piv_sorted) and (piv_sorted[j] - grp[0]) / max(grp[0], 1) <= 0.012:
            grp.append(piv_sorted[j])
            j += 1
        if len(grp) >= 2:
            clusters.append({"low": round(min(grp), 2), "high": round(max(grp), 2), "touches": len(grp)})
        i = j
    clusters.sort(key=lambda c: abs((c["low"] + c["high"]) / 2 - price))

    # Fair value gaps (3-bar) near price.
    fvgs = []
    h, l = hdf["high"].values, hdf["low"].values
    for i in range(2, len(hdf)):
        if l[i] > h[i - 2]:  # bullish FVG (demand)
            zlo, zhi = round(float(h[i - 2]), 2), round(float(l[i]), 2)
            kind = "demand"
        elif h[i] < l[i - 2]:  # bearish FVG (supply)
            zlo, zhi = round(float(h[i]), 2), round(float(l[i - 2]), 2)
            kind = "supply"
        else:
            continue
        mid = (zlo + zhi) / 2
        width = (zhi - zlo) / price
        # Near current price, sane gap width, and on the ACTIONABLE side:
        # supply FVGs act as resistance (above price), demand as support (below).
        if not (abs(mid - price) / price <= 0.06 and 0.001 <= width <= 0.035):
            continue
        if kind == "supply" and mid < price * 0.997:
            continue
        if kind == "demand" and mid > price * 1.003:
            continue
        fvgs.append({"type": kind, "low": zlo, "high": zhi})
    # keep the few closest, dedup by rounded midpoint
    seen = set()
    near_fvgs = []
    for f in sorted(fvgs, key=lambda x: abs((x["low"] + x["high"]) / 2 - price)):
        key = round((f["low"] + f["high"]) / 2, 0)
        if key in seen:
            continue
        seen.add(key)
        near_fvgs.append(f)
    return {
        "swing_high": round(swing_high, 2),
        "swing_low": round(swing_low, 2),
        "equilibrium": equilibrium,
        "resistance": resistance,
        "support": support,
        "clusters": clusters[:4],
        "imbalances": near_fvgs[:4],
    }


def trend_block(hdf):
    close = hdf["close"]
    e20, e50 = ema(close, 20), ema(close, 50)
    ph, pl = pivots(hdf)
    struct = "neutral"
    if len(ph) >= 2 and len(pl) >= 2:
        hh = ph[-1][1] > ph[-2][1]
        hl = pl[-1][1] > pl[-2][1]
        if hh and hl:
            struct = "uptrend (HH/HL)"
        elif not hh and not hl:
            struct = "downtrend (LH/LL)"
    ema_bull = e20.iloc[-1] > e50.iloc[-1] and e20.iloc[-1] > e20.iloc[-5]
    ema_bear = e20.iloc[-1] < e50.iloc[-1] and e20.iloc[-1] < e20.iloc[-5]
    trend = "bullish" if ema_bull else "bearish" if ema_bear else "neutral"
    return {"trend": trend, "structure": struct, "ema20": round(float(e20.iloc[-1]), 2), "ema50": round(float(e50.iloc[-1]), 2)}


def price_action(ddf):
    a = atr(ddf).iloc[-1]
    last = ddf.iloc[-1]
    today = float(last["close"] - last["open"])
    week = float(ddf["close"].iloc[-1] - ddf["close"].iloc[-6]) if len(ddf) > 6 else today

    def label(x):
        if abs(x) < 0.25 * a:
            return "neutral"
        return "bullish" if x > 0 else "bearish"

    return {"today": label(today), "week": label(week), "today_chg": round(today, 2), "week_chg": round(week, 2)}


# --------------------------------------------------------------------------- #
def analyze(ticker, htf, ltf):
    hdf = fetch_bars(ticker, htf)
    ldf = fetch_bars(ticker, ltf)

    # ---- Anti-stale / anti-hallucination gates -----------------------------
    # 1. The authoritative price is the snapshot last trade, NOT the last bar.
    snap = fetch_snapshot_price(ticker)
    bar_price = float(ldf["close"].iloc[-1])
    price = round(snap["price"] if snap["price"] else bar_price, 2)

    warnings = []
    # 2. Bars must agree with the snapshot within 1.5% — else the series is
    #    stale/truncated and levels/indicators can't be trusted.
    if snap["price"] and abs(bar_price - snap["price"]) / snap["price"] > 0.015:
        sys.exit(
            f"ERROR: stale bar data for {ticker} — last {ltf} bar close {bar_price:.2f} "
            f"vs live snapshot {snap['price']:.2f} (>1.5% apart). Refusing to emit a report."
        )
    # 3. Freshness: the last bar of each series must be recent (7 calendar
    #    days covers weekends + holidays; anything older means broken data).
    now = datetime.now(timezone.utc)
    for name, df in ((ltf, ldf), (htf, hdf)):
        age_days = (now - df["dt"].iloc[-1].to_pydatetime()).total_seconds() / 86400
        if age_days > 7:
            sys.exit(f"ERROR: {name} bars for {ticker} end {age_days:.1f} days ago — stale feed.")
        if age_days > 3:
            warnings.append(f"{name} bars end {age_days:.1f} days ago (holiday/weekend gap?)")
    if abs(bar_price - price) / price > 0.003:
        warnings.append(
            f"last {ltf} bar ({bar_price:.2f}) differs slightly from live price ({price:.2f}) — after-hours drift"
        )

    lv = levels_block(hdf, price)
    tr = trend_block(hdf)
    inds = indicator_verdicts(ldf)
    pa = price_action(hdf if htf == "day" else fetch_bars(ticker, "day"))

    bulls = [k for k, v in inds.items() if v.get("verdict") == "bullish"]
    bears = [k for k, v in inds.items() if v.get("verdict") == "bearish"]
    # Net bias: HTF trend is the anchor; LTF indicator tilt refines it.
    net = tr["trend"]
    if net == "neutral":
        net = "bullish" if len(bulls) > len(bears) else "bearish" if len(bears) > len(bulls) else "neutral"

    return {
        "ticker": ticker.upper(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_as_of": {
            "last_trade_price": snap["price"],
            "last_ltf_bar": ldf["dt"].iloc[-1].isoformat(),
            "last_htf_bar": hdf["dt"].iloc[-1].isoformat(),
        },
        "warnings": warnings,
        "htf": htf,
        "ltf": ltf,
        "price": price,
        "bias": net,
        "trend": tr,
        "price_action": pa,
        "indicators": inds,
        "indicator_tally": {"bullish": bulls, "bearish": bears},
        "levels": lv,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ticker")
    ap.add_argument("--htf", default="day", help="higher timeframe (trend + levels)")
    ap.add_argument("--ltf", default="hour", help="lower timeframe (indicators + entries)")
    a = ap.parse_args()
    print(json.dumps(analyze(a.ticker, a.htf, a.ltf), indent=2))


if __name__ == "__main__":
    main()
