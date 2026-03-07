# Yield Curve Heatmap

An interactive browser-based visualization of the German government yield curve, built with React and D3. Fetches monthly Svensson zero-coupon yields directly from the Deutsche Bundesbank's public SDMX REST API and renders them as a smooth, interpolated heatmap.

![Yield Curve Heatmap Preview](output/yield_curve_heatmap.png)

---

## What it shows

The heatmap encodes **25+ years of German sovereign yield curve data** in a single view. Each pixel represents one month in time (x-axis) at a specific maturity (y-axis, 1Y to 30Y). Color encodes the yield level — by default using the RdYlBu diverging palette, where red is high, white is neutral, and blue is low/negative.

### How to read it

- **Columns (left → right):** time, from your chosen start year to today
- **Rows (bottom → top):** maturity, from 1-year to 30-year bonds
- **Color:** yield level at that point in time and maturity
- **Vertical bands:** periods of uniformly high or low rates across all maturities — the 2015–2022 era of ECB negative rates appears as a deep blue band
- **Diagonal gradients:** a steep yield curve (short rates low, long rates high) shows as a strong top/bottom color contrast within the same column; an inverted curve flips this
- **Streaks along a row:** how a specific maturity's yield evolved over time — the 10Y row, for example, traces the full rate cycle clearly

The 2008 crash, 2011 Eurozone crisis, the decade of zero/negative rates, and the 2022–2023 hiking cycle are all immediately visible as distinct structural shifts in the heatmap without reading a single number.

---

## Data source

Yields are fetched from the **Deutsche Bundesbank SDMX REST API** (`BBSIS` dataflow), which publishes monthly Svensson zero-coupon yield estimates for German government bonds (`Bunds`) across 30 maturities.

**SDMX** (Statistical Data and Metadata eXchange) is the ISO standard used by central banks and statistical agencies worldwide for publishing structured time series. The Bundesbank exposes it as a REST endpoint that returns either XML or CSV. This app queries the CSV format:

```
GET https://api.statistiken.bundesbank.de/rest/data/BBSIS/{key}
    ?startPeriod=YYYY-MM&endPeriod=YYYY-MM&format=csv&lang=en
```

Each maturity has its own series key, e.g. the 10-year series:

```
M.I.ZST.ZI.EUR.S1311.B.A604.R10XX.R.A.A._Z._Z.A
```

The app fetches all 30 maturities sequentially (with a 250ms pause to respect rate limits), parses the CSV response, and merges everything into a single flat record array before rendering. If the API is unavailable (e.g. CORS restrictions in some environments), the app automatically falls back to a synthetic dataset generated with a Nelson-Siegel model calibrated to historical ECB rate decisions.

---

## Features

- **26 color palettes** across three categories: Classic (RdYlBu, Spectral, etc.), Sequential (Viridis, Plasma, Magma, etc.), and Abstract (Ember, Arctic, Neon, Dusk, and more)
- **Smooth bilinear interpolation** — the heatmap renders pixel-by-pixel via `ImageData` rather than discrete cells, producing the same fluid look as the matplotlib `bicubic` mode
- **Interactive tooltip** — hover any point to see the exact date, maturity, and yield value
- **Configurable date range and maturity range** — focus on any subset of the data
- **Grid lines and axis labels** toggle
- **High-resolution PNG export** — renders an offscreen 2560×1440 canvas and downloads directly from the browser
- **Responsive** — full desktop layout with sidebar controls; on mobile, a tabbed bottom sheet exposes all settings without sacrificing canvas space

---

## Running locally

No build step required beyond a standard React setup. Drop `yield-curve-heatmap.jsx` into any React project with `d3` available, or paste it directly into a Claude artifact / CodeSandbox.

```bash
npm install d3
```

Then import and render `<YieldCurveApp />` as your root component.

---

## Stack

| Layer | Library |
|---|---|
| UI | React 18 (hooks) |
| Data viz | D3 v7 (color interpolators, scales) |
| Rendering | HTML5 Canvas (`ImageData` for pixel-level bilinear interpolation) |
| Data | Bundesbank SDMX REST API → CSV |
| Fonts | IBM Plex Mono · Inter (Google Fonts) |

---

## Credits

Built by [Julian Hilgemann](https://www.julianhilgemann.com). Part of the [AgenticBI](https://www.youtube.com/@AgenticBI) project series.
