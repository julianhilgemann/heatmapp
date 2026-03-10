import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import * as d3 from "d3";
import Slider from "rc-slider";
import "rc-slider/assets/index.css";

// ── Bundesbank API ────────────────────────────────────────────────────────────

const ALL_MATS = Array.from({ length: 30 }, (_, i) => i + 1);
const BB_BASE = "https://api.statistiken.bundesbank.de/rest/data/BBSIS";

function getBBKey(m) {
  return `M.I.ZST.ZI.EUR.S1311.B.A604.R${String(m).padStart(2, "0")}XX.R.A.A._Z._Z.A`;
}

async function fetchMatCSV(m, s, e) {
  const url = `${BB_BASE}/${getBBKey(m)}?startPeriod=${s}&endPeriod=${e}&format=csv&lang=en`;
  const r = await fetch(url, {
    headers: { Accept: "text/csv" },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

function parseCSV(txt, m) {
  return txt
    .split("\n")
    .filter((l) => /^\d{4}-\d{2}/.test(l.trim()))
    .flatMap((line) => {
      const delim = line.includes(";") ? ";" : ",";
      const parts = line.split(delim);
      const date = parts[0]?.trim();
      const value = parseFloat((parts[1] || "").trim().replace(",", "."));
      return date && !isNaN(value) ? [{ date, maturity: m, value }] : [];
    });
}

// ── Synthetic Data (Nelson-Siegel + ECB rate model) ───────────────────────────

function makeSynthData(sy, ey) {
  const recs = [];

  function ecb(y, m) {
    const t = y + m / 12;
    if (t < 2003) return 3.5 + Math.sin((t - 2000) * 1.5) * 0.7;
    if (t < 2006) return 2.0 + (t - 2003) * 0.4;
    if (t < 2008.5) return 3.2 + (t - 2006) * 0.45;
    if (t < 2009.5) return Math.max(0.25, 4.4 - (t - 2008.5) * 4.2);
    if (t < 2011) return 0.25;
    if (t < 2012) return 0.25 + (t - 2011) * 1.25;
    if (t < 2013.5) return Math.max(0.25, 1.5 - (t - 2012) * 0.83);
    if (t < 2015.5) return Math.max(0.05, 0.25 - (t - 2013.5) * 0.1);
    if (t < 2022) return -0.5;
    if (t < 2023.5) return -0.5 + (t - 2022) * 3.3;
    return Math.max(3.5, 4.5 - (t - 2023.5) * 0.55);
  }

  for (let y = sy; y <= ey; y++) {
    const mmax = y === ey ? new Date().getMonth() + 1 : 12;
    for (let m = 0; m < mmax; m++) {
      const date = `${y}-${String(m + 1).padStart(2, "0")}`;
      const b = ecb(y, m);
      for (const mat of ALL_MATS) {
        const λ = 2.5, tau = mat / λ;
        const f1 = (1 - Math.exp(-tau)) / tau;
        const f2 = f1 - Math.exp(-tau);
        const β0 = b + 1.8;
        const β1 = -(b > 0.5 ? 1.3 : 2.2);
        const β2 = 0.9;
        const val = Math.max(-1.5, β0 + β1 * f1 + β2 * f2);
        recs.push({ date, maturity: mat, value: parseFloat(val.toFixed(3)) });
      }
    }
  }
  return recs;
}

// ── Color Palettes ────────────────────────────────────────────────────────────

// Custom interpolators using d3.scaleSequential / d3.piecewiseLinear approach
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpColor(c0, c1, t) {
  return `rgb(${Math.round(lerp(c0[0], c1[0], t))},${Math.round(lerp(c0[1], c1[1], t))},${Math.round(lerp(c0[2], c1[2], t))})`;
}
function piecewise(stops) {
  // stops: [[t, [r,g,b]], ...]
  return (t) => {
    for (let i = 0; i < stops.length - 1; i++) {
      const [t0, c0] = stops[i];
      const [t1, c1] = stops[i + 1];
      if (t <= t1) {
        const f = (t - t0) / (t1 - t0 || 1);
        return lerpColor(c0, c1, Math.max(0, Math.min(1, f)));
      }
    }
    return lerpColor(stops[stops.length - 2][1], stops[stops.length - 1][1], 1);
  };
}

const PALETTES = {
  // ── Classic / Scientific ─────────────────────────────────────────────
  "RdYlBu": { label: "RdYlBu", group: "Classic", fn: (t) => d3.interpolateRdYlBu(1 - t) },
  "Spectral": { label: "Spectral", group: "Classic", fn: (t) => d3.interpolateSpectral(1 - t) },
  "RdBu": { label: "Red → Blue", group: "Classic", fn: (t) => d3.interpolateRdBu(1 - t) },
  "PuOr": { label: "Purple → Org", group: "Classic", fn: (t) => d3.interpolatePuOr(t) },
  "BrBG": { label: "Brown → Teal", group: "Classic", fn: (t) => d3.interpolateBrBG(t) },
  "PRGn": { label: "Purple → Grn", group: "Classic", fn: (t) => d3.interpolatePRGn(t) },
  "PiYG": { label: "Pink → Green", group: "Classic", fn: (t) => d3.interpolatePiYG(t) },
  // ── Sequential Perceptual ────────────────────────────────────────────
  "Viridis": { label: "Viridis", group: "Sequential", fn: (t) => d3.interpolateViridis(t) },
  "Plasma": { label: "Plasma", group: "Sequential", fn: (t) => d3.interpolatePlasma(t) },
  "Magma": { label: "Magma", group: "Sequential", fn: (t) => d3.interpolateMagma(t) },
  "Inferno": { label: "Inferno", group: "Sequential", fn: (t) => d3.interpolateInferno(t) },
  "Cividis": { label: "Cividis", group: "Sequential", fn: (t) => d3.interpolateCividis(t) },
  "Turbo": { label: "Turbo", group: "Sequential", fn: (t) => d3.interpolateTurbo(t) },
  "Warm": { label: "Warm", group: "Sequential", fn: (t) => d3.interpolateWarm(t) },
  "Cool": { label: "Cool", group: "Sequential", fn: (t) => d3.interpolateCool(t) },
  "CubeHelix": { label: "CubeHelix", group: "Sequential", fn: (t) => d3.interpolateCubehelixDefault(t) },
  // ── Abstract / Artistic ──────────────────────────────────────────────
  "Ember": {
    label: "Ember", group: "Abstract", fn: piecewise([
      [0, [5, 5, 20]],
      [0.2, [60, 0, 80]],
      [0.45, [180, 20, 10]],
      [0.65, [230, 120, 0]],
      [0.82, [255, 210, 50]],
      [1, [255, 255, 240]],
    ])
  },
  "Arctic": {
    label: "Arctic", group: "Abstract", fn: piecewise([
      [0, [2, 8, 30]],
      [0.25, [0, 60, 120]],
      [0.5, [20, 160, 200]],
      [0.72, [150, 220, 240]],
      [0.88, [210, 240, 255]],
      [1, [255, 255, 255]],
    ])
  },
  "Acid": {
    label: "Acid", group: "Abstract", fn: piecewise([
      [0, [10, 0, 40]],
      [0.2, [80, 0, 200]],
      [0.4, [0, 200, 180]],
      [0.6, [150, 255, 0]],
      [0.8, [255, 220, 0]],
      [1, [255, 80, 200]],
    ])
  },
  "Midnight": {
    label: "Midnight", group: "Abstract", fn: piecewise([
      [0, [0, 0, 10]],
      [0.3, [10, 10, 80]],
      [0.55, [60, 0, 140]],
      [0.75, [160, 40, 120]],
      [0.9, [220, 160, 80]],
      [1, [255, 240, 200]],
    ])
  },
  "Moss": {
    label: "Moss", group: "Abstract", fn: piecewise([
      [0, [5, 15, 5]],
      [0.25, [20, 60, 20]],
      [0.5, [80, 130, 40]],
      [0.72, [160, 200, 60]],
      [0.88, [220, 240, 160]],
      [1, [255, 255, 230]],
    ])
  },
  "Copper": {
    label: "Copper", group: "Abstract", fn: piecewise([
      [0, [10, 4, 0]],
      [0.3, [80, 30, 5]],
      [0.55, [180, 80, 20]],
      [0.75, [210, 140, 60]],
      [0.9, [240, 200, 120]],
      [1, [255, 245, 200]],
    ])
  },
  "Neon": {
    label: "Neon", group: "Abstract", fn: piecewise([
      [0, [0, 0, 0]],
      [0.2, [0, 30, 80]],
      [0.4, [0, 200, 255]],
      [0.6, [100, 255, 100]],
      [0.8, [255, 255, 0]],
      [1, [255, 0, 180]],
    ])
  },
  "Dusk": {
    label: "Dusk", group: "Abstract", fn: piecewise([
      [0, [8, 5, 30]],
      [0.25, [60, 20, 80]],
      [0.5, [180, 60, 80]],
      [0.72, [220, 130, 80]],
      [0.88, [240, 200, 120]],
      [1, [255, 240, 200]],
    ])
  },
  "Mono": {
    label: "Monochrome", group: "Abstract", fn: (t) => {
      const v = Math.round(t * 255);
      return `rgb(${v},${v},${v})`;
    }
  },
  "InvMono": {
    label: "Inv. Mono", group: "Abstract", fn: (t) => {
      const v = Math.round((1 - t) * 255);
      return `rgb(${v},${v},${v})`;
    }
  },
};

const PALETTE_GROUPS = ["Classic", "Sequential", "Abstract"];
const PALETTE_KEYS = Object.keys(PALETTES);

function toRGB(s) {
  const c = d3.color(s);
  if (c) return [c.r | 0, c.g | 0, c.b | 0];
  const m = s.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  return m ? [+m[1], +m[2], +m[3]] : [128, 128, 128];
}

// ── Canvas Heatmap Renderer ───────────────────────────────────────────────────

function renderCanvas(canvas, { recs, cfn, minV, maxV, matMin, matMax, showGrid, showLabels, dpr = 1 }) {
  if (!canvas || !recs?.length || minV == null || maxV == null) return;

  const ctx = canvas.getContext("2d");
  const W = canvas.width / dpr, H = canvas.height / dpr;

  // Padding
  const P = showLabels
    ? { t: 20, r: 24, b: 52, l: 56 }
    : { t: 8, r: 8, b: 8, l: 8 };

  const pw = W - P.l - P.r;
  const ph = H - P.t - P.b;

  // Background
  ctx.fillStyle = "#07090F";
  ctx.fillRect(0, 0, W, H);

  const fr = recs.filter((r) => r.maturity >= matMin && r.maturity <= matMax);
  const dates = [...new Set(fr.map((r) => r.date))].sort();
  const mats = [...new Set(fr.map((r) => r.maturity))].sort((a, b) => a - b);
  const nD = dates.length, nM = mats.length;

  if (!nD || !nM || pw <= 0 || ph <= 0) return;

  const lk = new Map(fr.map((r) => [`${r.date}|${r.maturity}`, r.value]));
  const rng = maxV - minV || 1;

  // ── Smooth bilinear interpolation via ImageData ──
  const physW = Math.round(pw * dpr);
  const physH = Math.round(ph * dpr);
  if (physW <= 0 || physH <= 0) return;

  const img = ctx.createImageData(physW, physH);
  const dt = img.data;

  for (let x = 0; x < physW; x++) {
    for (let y = 0; y < physH; y++) {
      const gx = (x / (physW - 1)) * (nD - 1);
      const gy = ((physH - 1 - y) / (physH - 1)) * (nM - 1);

      const x0 = Math.floor(gx) | 0, x1 = Math.min(x0 + 1, nD - 1);
      const y0 = Math.floor(gy) | 0, y1 = Math.min(y0 + 1, nM - 1);
      const fx = gx - x0, fy = gy - y0;

      const v00 = lk.get(`${dates[x0]}|${mats[y0]}`);
      const v10 = lk.get(`${dates[x1]}|${mats[y0]}`);
      const v01 = lk.get(`${dates[x0]}|${mats[y1]}`);
      const v11 = lk.get(`${dates[x1]}|${mats[y1]}`);

      const def = [v00, v10, v01, v11].filter((v) => v != null);
      if (!def.length) continue;

      const val =
        def.length === 4
          ? v00 * (1 - fx) * (1 - fy) +
          v10 * fx * (1 - fy) +
          v01 * (1 - fx) * fy +
          v11 * fx * fy
          : def.reduce((a, b) => a + b, 0) / def.length;

      const t = Math.max(0, Math.min(1, (val - minV) / rng));
      const [r, g, b] = toRGB(cfn(t));
      const i = (y * physW + x) * 4;
      dt[i] = r; dt[i + 1] = g; dt[i + 2] = b; dt[i + 3] = 255;
    }
  }

  ctx.putImageData(img, Math.round(P.l * dpr), Math.round(P.t * dpr));

  // ── Plot border ──
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 0.75;
  ctx.strokeRect(P.l + 0.5, P.t + 0.5, pw - 1, ph - 1);

  if (!showLabels) return;

  // ── Grid lines ──
  if (showGrid) {
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 0.5;
    const uYrs = [...new Set(dates.map((d) => d.slice(0, 4)))];
    uYrs.forEach((yr) => {
      const fi = dates.findIndex((d) => d.startsWith(yr));
      if (fi < 0) return;
      const xp = P.l + (fi / (nD - 1)) * pw;
      ctx.beginPath(); ctx.moveTo(xp, P.t); ctx.lineTo(xp, P.t + ph); ctx.stroke();
    });
    [5, 10, 15, 20, 25].filter((m) => m > matMin && m < matMax).forEach((mat) => {
      const mi = mats.indexOf(mat);
      if (mi < 0) return;
      const yp = P.t + ph - (mi / (nM - 1)) * ph;
      ctx.beginPath(); ctx.moveTo(P.l, yp); ctx.lineTo(P.l + pw, yp); ctx.stroke();
    });
  }

  // ── Axes ──
  const ink = "rgba(255,255,255,0.45)";
  const fs = Math.max(9, Math.min(12, W / 100));
  ctx.font = `500 ${fs}px "IBM Plex Mono", "Courier New", monospace`;
  ctx.fillStyle = ink;

  // X: year labels
  const uYrs2 = [...new Set(dates.map((d) => parseInt(d.slice(0, 4))))];
  const yStep = uYrs2.length > 20 ? 5 : uYrs2.length > 10 ? 2 : 1;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  uYrs2.filter((_, i) => i % yStep === 0).forEach((yr) => {
    const fi = dates.findIndex((d) => d.startsWith(String(yr)));
    if (fi < 0) return;
    const xp = P.l + (fi / (nD - 1)) * pw;
    ctx.fillStyle = ink;
    ctx.fillText(yr, xp, P.t + ph + 10);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(xp, P.t + ph); ctx.lineTo(xp, P.t + ph + 5); ctx.stroke();
  });

  // Y: maturity labels
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  [1, 2, 3, 5, 7, 10, 15, 20, 25, 30].filter((m) => m >= matMin && m <= matMax).forEach((mat) => {
    const mi = mats.indexOf(mat);
    if (mi < 0) return;
    const yp = P.t + ph - (mi / (nM - 1)) * ph;
    ctx.fillStyle = ink;
    ctx.fillText(`${mat}Y`, P.l - 8, yp);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(P.l - 4, yp); ctx.lineTo(P.l, yp); ctx.stroke();
  });
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function YieldCurveApp() {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  const [recs, setRecs] = useState(() => makeSynthData(2000, 2025));
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dataSource, setDataSource] = useState("Data: Synthetic");
  const [errMsg, setErrMsg] = useState("");

  const [startYear, setStartYear] = useState(2000);
  const [endYear, setEndYear] = useState(2025);
  const [palette, setPalette] = useState("RdYlBu");
  const [paletteGroup, setPaletteGroup] = useState("Classic");
  const [matMin, setMatMin] = useState(1);
  const [matMax, setMatMax] = useState(30);
  const [showGrid, setShowGrid] = useState(true);
  const [showLabels, setShowLabels] = useState(true);

  const [tooltip, setTooltip] = useState(null);
  const [showPopup, setShowPopup] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [mobTab, setMobTab] = useState("palette");
  const [dims, setDims] = useState({ w: 800, h: 500 });
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const maxDataYear = useMemo(() => {
    if (!recs?.length) return new Date().getFullYear();
    const years = recs.map(r => parseInt(r.date.split("-")[0]));
    return Math.max(...years);
  }, [recs]);

  const { minV, maxV, dates, mats } = useMemo(() => {
    if (!recs?.length) return {};
    const fr = recs.filter((r) => {
      const y = parseInt(r.date.split("-")[0]);
      return r.maturity >= matMin && r.maturity <= matMax && y >= startYear && y <= endYear;
    });
    const vals = fr.map((r) => r.value);
    const dates = [...new Set(fr.map((r) => r.date))].sort();
    const mats = [...new Set(fr.map((r) => r.maturity))].sort((a, b) => a - b);
    return {
      minV: parseFloat(d3.min(vals)?.toFixed(3) || 0),
      maxV: parseFloat(d3.max(vals)?.toFixed(3) || 0),
      dates,
      mats,
    };
  }, [recs, matMin, matMax, startYear, endYear]);

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 10 && height > 10) setDims({ w: Math.floor(width), h: Math.floor(height) });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Redraw
  useEffect(() => {
    if (!canvasRef.current || minV == null) return;
    const c = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    c.width = dims.w * dpr;
    c.height = dims.h * dpr;
    c.style.width = dims.w + "px";
    c.style.height = dims.h + "px";
    const ctx = c.getContext("2d");
    ctx.scale(dpr, dpr);

    const fr = recs.filter((r) => {
      const y = parseInt(r.date.split("-")[0]);
      return r.maturity >= matMin && r.maturity <= matMax && y >= startYear && y <= endYear;
    });

    renderCanvas(c, { recs: fr, cfn: PALETTES[palette].fn, minV, maxV, matMin, matMax, showGrid, showLabels, dpr });
  }, [recs, dims, palette, matMin, matMax, showGrid, showLabels, minV, maxV, startYear, endYear]);

  // Fetch from Bundesbank
  const handleFetch = async () => {
    setLoading(true);
    setErrMsg("");
    setProgress(0);
    const fetchStartY = 2000;
    const fetchEndY = new Date().getFullYear();
    const start = `${fetchStartY}-01`, end = `${fetchEndY}-12`;
    const matsToFetch = ALL_MATS; // always fetch all
    const all = [];

    try {
      for (let i = 0; i < matsToFetch.length; i++) {
        const m = matsToFetch[i];
        const csv = await fetchMatCSV(m, start, end);
        all.push(...parseCSV(csv, m));
        setProgress(Math.round(((i + 1) / matsToFetch.length) * 100));
        if (i < matsToFetch.length - 1) await new Promise((r) => setTimeout(r, 250));
      }
      if (!all.length) throw new Error("No data returned");
      setRecs(all);
      setDataSource(`Data: Bundesbank`);
      
      // Reset view to default
      setStartYear(fetchStartY);
      setEndYear(fetchEndY);
      setMatMin(1);
      setMatMax(30);
      setShowGrid(true);
      setShowLabels(true);
    } catch (err) {
      setErrMsg(`API unavailable (${err.message}). Showing synthetic data.`);
      setRecs(makeSynthData(fetchStartY, fetchEndY));
      setDataSource("Data: Synthetic");
      
      setStartYear(fetchStartY);
      setEndYear(fetchEndY);
      setMatMin(1);
      setMatMax(30);
      setShowGrid(true);
      setShowLabels(true);
    }
    setLoading(false);
  };

  // Tooltip on hover
  const handleMouseMove = useCallback(
    (e) => {
      if (!canvasRef.current || !dates?.length || !mats?.length) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const W = rect.width, H = rect.height;
      const P = showLabels ? { t: 20, r: 24, b: 52, l: 56 } : { t: 8, r: 8, b: 8, l: 8 };
      const pw = W - P.l - P.r, ph = H - P.t - P.b;

      if (cx < P.l || cx > P.l + pw || cy < P.t || cy > P.t + ph) {
        setTooltip(null);
        return;
      }

      const gx = ((cx - P.l) / pw) * (dates.length - 1);
      const gy = (1 - (cy - P.t) / ph) * (mats.length - 1);
      const di = Math.round(Math.max(0, Math.min(dates.length - 1, gx)));
      const mi = Math.round(Math.max(0, Math.min(mats.length - 1, gy)));

      const date = dates[di], mat = mats[mi];
      const rec = recs.find((r) => r.date === date && r.maturity === mat);
      setTooltip(rec ? { x: e.clientX, y: e.clientY, date, mat, value: rec.value } : null);
    },
    [dates, mats, recs, showLabels]
  );

  // High-res export
  const executeExport = useCallback(() => {
    setExporting(true);
    setTimeout(() => {
      const off = document.createElement("canvas");
      off.width = 5120;
      off.height = 2880;
      const ctx = off.getContext("2d");
      ctx.scale(2, 2);
      
      // We pass the currently filtered records instead of all records
      const fr = recs.filter((r) => {
        const y = parseInt(r.date.split("-")[0]);
        return r.maturity >= matMin && r.maturity <= matMax && y >= startYear && y <= endYear;
      });

      renderCanvas(off, {
        recs: fr,
        cfn: PALETTES[palette].fn,
        minV,
        maxV,
        matMin,
        matMax,
        showGrid: showLabels ? showGrid : false,
        showLabels,
        dpr: 2,
      });
      off.toBlob((blob) => {
        if (!blob) {
          setExporting(false);
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `yield-curve-${palette.toLowerCase()}-${startYear}-${endYear}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => { URL.revokeObjectURL(url); setExporting(false); setShowPopup(false); }, 1000);
      }, "image/png");
    }, 50);
  }, [recs, palette, minV, maxV, matMin, matMax, showGrid, showLabels, startYear, endYear]);

  // CSV Export (Dates as Rows, Maturities as Columns)
  const executeExportCSV = useCallback(() => {
    const fr = recs.filter((r) => {
      const y = parseInt(r.date.split("-")[0]);
      return r.maturity >= matMin && r.maturity <= matMax && y >= startYear && y <= endYear;
    });
    
    // Extract unique sorted dates and maturities from the filtered set
    const fDates = [...new Set(fr.map(r => r.date))].sort();
    const fMats = [...new Set(fr.map(r => r.maturity))].sort((a, b) => a - b);
    
    // Header row: "Date", then each maturity column
    const header = ["Date", ...fMats].join(",");
    
    // Group records by date for fast lookup
    const ByDateMat = {};
    fr.forEach(r => {
      if (!ByDateMat[r.date]) ByDateMat[r.date] = {};
      ByDateMat[r.date][r.maturity] = r.value;
    });

    // Generate rows
    const rows = fDates.map(d => {
      const rowVals = fMats.map(m => {
        const val = ByDateMat[d][m];
        return val !== undefined ? val.toFixed(2) : "";
      });
      return [d, ...rowVals].join(",");
    });

    const csvContent = [header, ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `yield-curve-data-${startYear}-${endYear}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [recs, matMin, matMax, startYear, endYear]);

  // Color bar gradient CSS string
  const colorBarGrad = useMemo(() => {
    const fn = PALETTES[palette].fn;
    const stops = Array.from({ length: 14 }, (_, i) => fn(i / 13)).join(", ");
    return `linear-gradient(to right, ${stops})`;
  }, [palette]);

  // ── Style tokens ──────────────────────────────────────────────────────────
  const tok = {
    bg: "#07090F",
    sidebar: "#0C0D18",
    border: "rgba(255,255,255,0.07)",
    accent: "#D4723C",
    accentBlue: "#334C65",
    text: "#FFFFFF",
    muted: "#FFFFFF",
    subtle: "rgba(255,255,255,0.08)",
    lbl: {
      fontSize: 10,
      letterSpacing: "0.12em",
      color: "#FFFFFF",
      textTransform: "uppercase",
      fontWeight: 600,
      marginBottom: 10,
      display: "flex",
      alignItems: "center",
      gap: 6,
      fontFamily: '"IBM Plex Mono", monospace',
    },
    section: {
      padding: "18px 20px",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
    },
    sel: {
      background: "rgba(255,255,255,0.05)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: 7,
      color: "#E2E2E8",
      padding: "8px 10px",
      fontSize: 12,
      fontFamily: "Inter, -apple-system, sans-serif",
      outline: "none",
      cursor: "pointer",
      width: "100%",
      appearance: "none",
      WebkitAppearance: "none",
    },
    numIn: {
      background: "rgba(255,255,255,0.05)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: 7,
      color: "#E2E2E8",
      padding: "8px 0",
      fontSize: 13,
      textAlign: "center",
      fontFamily: '"IBM Plex Mono", monospace',
      outline: "none",
      width: 68,
    },
    btn: {
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: 8,
      color: "#E2E2E8",
      padding: "10px 14px",
      fontSize: 12,
      cursor: "pointer",
      fontFamily: "Inter, -apple-system, sans-serif",
      fontWeight: 500,
      width: "100%",
      textAlign: "center",
      letterSpacing: "0.03em",
      transition: "background 0.2s, border-color 0.2s",
    },
    btnPrimary: {
      background: "#FFFFFF",
      border: "none",
      borderRadius: 8,
      color: "#07090F",
      padding: "11px 16px",
      fontSize: 11,
      cursor: "pointer",
      fontFamily: "Inter, -apple-system, sans-serif",
      fontWeight: 700,
      letterSpacing: "0.08em",
      width: "100%",
      transition: "opacity 0.2s",
    },
    mutedSpan: { fontSize: 11, color: "#FFFFFF", lineHeight: 1.55, fontFamily: "Inter, -apple-system, sans-serif" },
    footerSpan: { fontSize: 11, color: "rgba(255,255,255,0.35)", lineHeight: 1.55, fontFamily: "Inter, -apple-system, sans-serif" },
    tTrack: (on) => ({
      width: 34,
      height: 20,
      borderRadius: 10,
      background: on ? "rgba(212,114,60,0.9)" : "rgba(255,255,255,0.12)",
      position: "relative",
      transition: "background 0.22s",
      flexShrink: 0,
    }),
    tThumb: (on) => ({
      position: "absolute",
      top: 2,
      left: on ? 16 : 2,
      width: 16,
      height: 16,
      borderRadius: "50%",
      background: on ? "#fff" : "rgba(255,255,255,0.45)",
      transition: "left 0.22s cubic-bezier(.4,0,.2,1)",
    }),
  };

  return (
    <>
      {/* Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; overscroll-behavior: none; }
        body { background: #07090F; -webkit-text-size-adjust: 100%; }

        .yc-wrap {
          display: flex;
          height: 100dvh;
          width: 100vw;
          background: #07090F;
          color: #E2E2E8;
          font-family: Inter, -apple-system, sans-serif;
          overflow: hidden;
          flex-direction: row;
          position: relative;
        }

        .yc-sidebar { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent; }
        .yc-sidebar::-webkit-scrollbar { width: 4px; }
        .yc-sidebar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }

        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { opacity: 1; filter: invert(0.7); }

        .toggle-row { display:flex; align-items:center; justify-content:space-between; cursor:pointer; user-select:none; padding: 3px 0; }
        .toggle-row + .toggle-row { margin-top: 10px; }
        .primary-btn:hover { opacity: 0.88; }
        .fetch-btn:hover { background: rgba(255,255,255,0.1) !important; border-color: rgba(255,255,255,0.18) !important; }

        /* ── Mobile bottom sheet (hidden on desktop) ── */
        .mob-bottom-sheet { display: none; }

        @media (max-width: 767px) {
          .yc-wrap { flex-direction: column; }
          .yc-sidebar { display: none !important; }

          .yc-main {
            flex: 1 !important;
            min-height: 0 !important;
            padding: 70px 10px 8px !important;
            overflow: hidden !important;
          }
          .yc-main canvas { width: 100% !important; height: 100% !important; }

          /* Bottom sheet */
          .mob-bottom-sheet {
            display: flex;
            flex-direction: column;
            flex-shrink: 0;
            height: calc(50dvh + env(safe-area-inset-bottom));
            background: #0C0D18;
            border-top: 1px solid rgba(255,255,255,0.08);
            overflow: hidden;
          }

          /* Tab bar */
          .mob-tab-bar {
            display: flex;
            flex-shrink: 0;
            height: 40px;
            border-bottom: 1px solid rgba(255,255,255,0.07);
            overflow-x: auto;
            scrollbar-width: none;
          }
          .mob-tab-bar::-webkit-scrollbar { display: none; }
          .mob-tab {
            flex: 1;
            min-width: 56px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            font-weight: 600;
            font-family: Inter, sans-serif;
            letter-spacing: 0.05em;
            color: rgba(255,255,255,0.35);
            cursor: pointer;
            border: none;
            background: transparent;
            border-bottom: 2px solid transparent;
            transition: color 0.15s, border-color 0.15s;
            white-space: nowrap;
            padding: 0 8px;
            -webkit-tap-highlight-color: transparent;
          }
          .mob-tab.active { color: #fff; border-bottom-color: #D4723C; }

          /* Panel */
          .mob-panel {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 12px 14px calc(20px + env(safe-area-inset-bottom));
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
          }
          .mob-panel::-webkit-scrollbar { display: none; }

          /* Palette swatch horizontal strip */
          .mob-palette-strip {
            display: flex;
            gap: 7px;
            overflow-x: auto;
            scrollbar-width: none;
            padding-bottom: 2px;
            -webkit-overflow-scrolling: touch;
          }
          .mob-palette-strip::-webkit-scrollbar { display: none; }
          .mob-swatch {
            flex-shrink: 0;
            width: 76px;
            cursor: pointer;
            border-radius: 7px;
            overflow: hidden;
            border: 1px solid rgba(255,255,255,0.07);
            transition: border-color 0.15s;
            -webkit-tap-highlight-color: transparent;
          }
          .mob-swatch.active { border-color: rgba(255,255,255,0.4); box-shadow: 0 0 0 1px rgba(255,255,255,0.12); }
          .mob-swatch-bar { height: 26px; width: 100%; }
          .mob-swatch-lbl {
            font-size: 9px;
            font-family: "IBM Plex Mono", monospace;
            color: rgba(255,255,255,0.35);
            padding: 3px 5px;
            background: rgba(255,255,255,0.02);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .mob-swatch.active .mob-swatch-lbl { color: rgba(255,255,255,0.85); background: rgba(255,255,255,0.05); }

          .yc-navbar { left: 16px !important; }
          .navbar-title { font-size: 12px !important; }
          .source-badge { display: none !important; }
        }

        /* ── Popup ── */
        .popup-overlay {
          position: fixed; inset: 0; z-index: 300;
          display: flex; align-items: center; justify-content: center;
          background: rgba(0,0,0,0.6);
          backdrop-filter: blur(12px);
          animation: fadeIn 0.2s ease;
          padding: 20px;
        }
        .popup-card {
          background: rgba(12,13,24,0.98);
          border: 1px solid rgba(255,255,255,0.14);
          border-radius: 20px;
          padding: 28px;
          width: 340px;
          max-width: 100%;
          box-shadow: 0 24px 64px rgba(0,0,0,0.7);
          backdrop-filter: blur(40px);
          animation: slideUp 0.25s cubic-bezier(0.16,1,0.3,1);
        }
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
        @keyframes slideUp { from { opacity:0; transform:translateY(12px) scale(0.97); } to { opacity:1; transform:translateY(0) scale(1); } }

        .tooltip-card {
          position: fixed;
          background: rgba(10,11,20,0.97);
          border: 1px solid rgba(255,255,255,0.13);
          border-radius: 12px;
          padding: 10px 14px;
          pointer-events: none;
          z-index: 200;
          backdrop-filter: blur(20px);
          box-shadow: 0 8px 28px rgba(0,0,0,0.55);
        }

        .progress-bar-wrap {
          height: 3px; background: rgba(255,255,255,0.08);
          border-radius: 2px; overflow: hidden; margin-bottom: 8px;
        }
        .progress-bar-fill {
          height: 100%;
          background: linear-gradient(90deg, #334C65, #D4723C);
          border-radius: 2px; transition: width 0.3s ease;
        }
        .color-bar { height: 10px; border-radius: 5px; margin-top: 10px; border: 1px solid rgba(255,255,255,0.06); }
        .range-labels { display: flex; justify-content: space-between; margin-top: 5px; }
        .source-badge {
          font-size: 10px; font-family: "IBM Plex Mono", monospace;
          color: rgba(255,255,255,0.5); letter-spacing: 0.04em;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px;
        }
      `}</style>

      <div className="yc-wrap">
        {/* ── Pill Navbar ───────────────────────────────────────────────── */}
        <div
          className="yc-navbar"
          style={{
            position: "absolute",
            top: 14,
            left: isMobile ? 16 : 316,
            right: 16,
            height: 46,
            borderRadius: 23,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.09)",
            boxShadow: "0 4px 28px rgba(0,0,0,0.35)",
            backdropFilter: "blur(28px)",
            WebkitBackdropFilter: "blur(28px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 20px",
            zIndex: 100,
          }}
        >
          <a
            href="https://www.julianhilgemann.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", flexShrink: 0 }}
          >
            <svg style={{ height: 22, width: "auto" }} viewBox="-16 -16 528.05 528.05" xmlns="http://www.w3.org/2000/svg">
              <circle cx="248.02" cy="248.02" r="240.02" fill="none" stroke="#fff" strokeMiterlimit="10" strokeWidth="24" />
              <polygon points="414.8 247.47 410.09 270.25 367.27 271.43 339.39 386.13 294.21 385.74 323.68 270.65 258.47 270.65 264.75 247.87 329.57 247.08 365.31 110 410.09 109.6 373.95 247.47 414.8 247.47" fill="#fff" />
              <path d="M196.7,262s-16-1-41.88.54c-55.68,3.24-70.22,41-71,63.83-2.4,69.53,84,63.73,109.2-14.34,11.07-34.27,45.19-175.44,46.2-177-36.09-.3-112.1-.45-112.1-.45s2.66-10.16,6.49-23.61l155.25-.25c-.2,1.05-25,106.7-47.43,183.68C215,385.08,146.67,399.39,125,398.4c-34.13-1.54-62.45-27.88-62.45-72.27C62.51,290,92.36,245.7,155.6,246l44.88-.2Z" transform="translate(-1.71 -1.87)" fill="#fff" />
            </svg>
          </a>

          <span style={{ fontSize: 14, fontWeight: 700, color: "#fff", letterSpacing: "0.02em", fontFamily: "Inter, sans-serif" }}>
            Interactive Yield Curve App
          </span>

          <div className="source-badge">{dataSource}</div>
        </div>

        {/* ── Sidebar ───────────────────────────────────────────────────── */}
        <div
          className="yc-sidebar"
          style={{
            width: 300,
            flexShrink: 0,
            background: tok.sidebar,
            borderRight: `1px solid ${tok.border}`,
            display: "flex",
            flexDirection: "column",
            overflowY: "auto",
            paddingTop: 74,
          }}
        >

          {/* Date Range */}
          <div style={tok.section} className="mob-section">
            <div style={tok.lbl}>Date Range</div>
            <div style={{ padding: "0 8px 10px" }}>
              <Slider
                range
                min={2000}
                max={maxDataYear}
                value={[startYear, Math.min(endYear, maxDataYear)]}
                onChange={(val) => { setStartYear(val[0]); setEndYear(val[1]); }}
                styles={{
                  track: { backgroundColor: '#D4723C' },
                  handle: { borderColor: '#D4723C', backgroundColor: '#FFF', opacity: 1 },
                  rail: { backgroundColor: 'rgba(255,255,255,0.1)' }
                }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#FFF", fontFamily: '"IBM Plex Mono", monospace' }}>
              <span>{startYear}</span>
              <span>{endYear}</span>
            </div>
          </div>

          {/* Maturity */}
          <div style={tok.section} className="mob-section">
            <div style={tok.lbl}>Maturity Range</div>
            <div style={{ padding: "0 8px 10px" }}>
              <Slider
                range
                min={1}
                max={30}
                value={[matMin, matMax]}
                onChange={(val) => { setMatMin(val[0]); setMatMax(val[1]); }}
                styles={{
                  track: { backgroundColor: '#D4723C' },
                  handle: { borderColor: '#D4723C', backgroundColor: '#FFF', opacity: 1 },
                  rail: { backgroundColor: 'rgba(255,255,255,0.1)' }
                }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#FFF", fontFamily: '"IBM Plex Mono", monospace' }}>
              <span>{matMin}Y</span>
              <span>{matMax}Y</span>
            </div>
          </div>

          {/* Palette */}
          <div style={tok.section} className="mob-section">
            <div style={tok.lbl}>Color Palette</div>
            {/* Group tabs */}
            <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
              {PALETTE_GROUPS.map((g) => (
                <button
                  key={g}
                  style={{
                    flex: 1,
                    background: paletteGroup === g ? "rgba(255,255,255,0.12)" : "transparent",
                    border: "1px solid",
                    borderColor: paletteGroup === g ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.07)",
                    borderRadius: 6,
                    color: paletteGroup === g ? "#fff" : "rgba(255,255,255,0.35)",
                    padding: "5px 0",
                    fontSize: 10,
                    fontWeight: paletteGroup === g ? 600 : 400,
                    cursor: "pointer",
                    letterSpacing: "0.05em",
                    fontFamily: "Inter, sans-serif",
                    transition: "all 0.15s",
                  }}
                  onClick={() => setPaletteGroup(g)}
                >
                  {g}
                </button>
              ))}
            </div>
            {/* Swatches grid */}
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {PALETTE_KEYS.filter((k) => PALETTES[k].group === paletteGroup).map((k) => {
                const fn = PALETTES[k].fn;
                const stops = Array.from({ length: 20 }, (_, i) => fn(i / 19)).join(", ");
                const grad = `linear-gradient(to right, ${stops})`;
                const isActive = palette === k;
                return (
                  <div
                    key={k}
                    onClick={() => setPalette(k)}
                    style={{
                      cursor: "pointer",
                      borderRadius: 7,
                      overflow: "hidden",
                      border: `1px solid ${isActive ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.06)"}`,
                      boxShadow: isActive ? "0 0 0 1px rgba(255,255,255,0.12)" : "none",
                      transition: "border-color 0.15s",
                    }}
                  >
                    <div style={{ background: grad, height: 24, width: "100%" }} />
                    <div style={{
                      padding: "3px 8px",
                      fontSize: 10,
                      fontFamily: '"IBM Plex Mono", monospace',
                      color: isActive ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.35)",
                      background: isActive ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.02)",
                      letterSpacing: "0.04em",
                    }}>
                      {PALETTES[k].label}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Selected range display */}
            <div className="range-labels" style={{ marginTop: 10 }}>
              <span style={tok.mutedSpan}>{minV != null ? `${minV.toFixed(2)}%` : "—"}</span>
              <span style={{ ...tok.mutedSpan, fontFamily: '"IBM Plex Mono", monospace', fontSize: 10 }}>yield %</span>
              <span style={tok.mutedSpan}>{maxV != null ? `${maxV.toFixed(2)}%` : "—"}</span>
            </div>
          </div>

          {/* Display Options */}
          <div style={tok.section} className="mob-section">
            <div style={tok.lbl}>Display</div>
            <div
              className="toggle-row"
              onClick={() => setShowLabels((v) => !v)}
            >
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", fontWeight: 500 }}>Axis Labels</span>
              <div style={tok.tTrack(showLabels)}>
                <div style={tok.tThumb(showLabels)} />
              </div>
            </div>
            <div
              className="toggle-row"
              onClick={() => { if (showLabels) setShowGrid((v) => !v); }}
              style={{ opacity: showLabels ? 1 : 0.4, pointerEvents: showLabels ? "auto" : "none" }}
            >
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", fontWeight: 500 }}>Grid Lines</span>
              <div style={tok.tTrack(showGrid && showLabels)}>
                <div style={tok.tThumb(showGrid && showLabels)} />
              </div>
            </div>
          </div>

          {/* Live Data Fetch */}
          <div style={tok.section} className="mob-section">
            <div style={tok.lbl}>Live Data</div>
            <p style={{ ...tok.mutedSpan, marginBottom: 12 }}>
              Fetches from Deutsche Bundesbank BBSIS (Svensson yield curve, 1–30Y monthly). Falls back to synthetic if CORS/network unavailable.
            </p>
            {errMsg && (
              <div style={{ ...tok.mutedSpan, color: "#F97316", marginBottom: 10 }}>{errMsg}</div>
            )}
            {loading && (
              <div style={{ marginBottom: 10 }}>
                <div className="progress-bar-wrap">
                  <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
                </div>
                <span style={tok.mutedSpan}>Fetching maturities… {progress}%</span>
              </div>
            )}
            <button
              className="fetch-btn"
              style={tok.btn}
              onClick={handleFetch}
              disabled={loading}
            >
              {loading ? `Loading… ${progress}%` : "↓  Fetch Live Data"}
            </button>
          </div>

          {/* Export */}
          <div style={{ ...tok.section, borderBottom: "none" }} className="mob-section">
            <div style={tok.lbl}>Export</div>
            <p style={{ ...tok.mutedSpan, marginBottom: 12 }}>Download chart or data</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
              <button
                className="primary-btn"
                style={{ ...tok.btnPrimary, width: "100%" }}
                onClick={() => setShowPopup(true)}
              >
                ↓  EXPORT PNG
              </button>
              <span
                style={{ ...tok.mutedSpan, fontSize: 13, textDecoration: "underline", cursor: "pointer", opacity: 0.8 }}
                onClick={executeExportCSV}
              >
                Export CSV Data (Matrix)
              </span>
            </div>
          </div>

          {/* Footer */}
          <div
            className="sidebar-footer"
            style={{
              marginTop: "auto",
              padding: "20px",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              alignItems: "center",
              borderTop: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <span style={tok.footerSpan}>Made with ❤️ by Julian Hilgemann</span>
            <a
              href="https://www.julianhilgemann.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...tok.footerSpan, color: "rgba(255,255,255,0.3)", textDecoration: "none" }}
            >
              julianhilgemann.com
            </a>
          </div>
        </div>

        {/* ── Main Canvas ───────────────────────────────────────────────── */}
        <div
          ref={containerRef}
          className="yc-main"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            padding: "76px 16px 16px",
            overflow: "hidden",
            background: "#05050A",
            position: "relative",
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.07)",
              cursor: "crosshair",
              display: "block",
            }}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setTooltip(null)}
          />
        </div>

        {/* ── Tooltip ───────────────────────────────────────────────────── */}
        {tooltip && (
          <div
            className="tooltip-card"
            style={{
              left: Math.min(tooltip.x + 14, window.innerWidth - 160),
              top: Math.max(40, Math.min(tooltip.y - 30, window.innerHeight - 100)),
            }}
          >
            <div style={{ ...tok.mutedSpan, fontSize: 10, fontFamily: '"IBM Plex Mono", monospace', marginBottom: 5 }}>
              {tooltip.date} · {tooltip.mat}Y maturity
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 600,
                color: "#fff",
                fontFamily: '"IBM Plex Mono", monospace',
                letterSpacing: "-0.02em",
                lineHeight: 1.1,
              }}
            >
              {tooltip.value.toFixed(2)}
              <span style={{ fontSize: 13, fontWeight: 400, color: "rgba(255,255,255,0.45)", marginLeft: 2 }}>%</span>
            </div>
            <div style={{ marginTop: 6, height: 3, width: 100, borderRadius: 2, background: colorBarGrad, opacity: 0.7 }} />
          </div>
        )}

        {/* ── Export / BuyMeACoffee Popup ───────────────────────────────── */}
        {showPopup && (
          <div className="popup-overlay" onClick={() => setShowPopup(false)}>
            <div className="popup-card" onClick={(e) => e.stopPropagation()}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: "rgba(212,114,60,0.15)",
                  border: "1px solid rgba(212,114,60,0.3)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 16,
                  fontSize: 20,
                }}
              >
                ☕
              </div>
              <h3 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", gap: 8 }}>
                {exporting && (
                  <div style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#FFF", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                )}
                {exporting ? "Exporting..." : "Support my work"}
              </h3>
              <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
              {exporting ? (
                <p style={{ margin: "0 0 24px", fontSize: 14, color: "rgba(255,255,255,0.55)", lineHeight: 1.65 }}>
                  Calculating 14.7M pixels, this may take a few seconds.
                </p>
              ) : (
                <p style={{ margin: "0 0 24px", fontSize: 14, color: "rgba(255,255,255,0.55)", lineHeight: 1.65 }}>
                  If this tool has been useful for your research or work, consider buying me a coffee to support continued development!
                </p>
              )}
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: "1px solid rgba(255,255,255,0.18)",
                    borderRadius: 10,
                    padding: "12px 0",
                    color: "rgba(255,255,255,0.75)",
                    fontSize: 13,
                    cursor: exporting ? "not-allowed" : "pointer",
                    fontFamily: "Inter, sans-serif",
                    transition: "background 0.2s",
                    opacity: exporting ? 0.6 : 1,
                  }}
                  onClick={executeExport}
                  disabled={exporting}
                >
                  {exporting ? "Wait..." : "Just Download"}
                </button>
                <a
                  href="https://buymeacoffee.com/julianhilgemann"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => !exporting && executeExport()}
                  style={{
                    ...{
                      flex: 1,
                      background: "#FFDD00",
                      color: "#000",
                      borderRadius: 10,
                      padding: "12px 0",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: exporting ? "not-allowed" : "pointer",
                      textDecoration: "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      fontFamily: "Inter, sans-serif",
                      boxShadow: "0 2px 12px rgba(255,221,0,0.25)",
                    },
                    ...(exporting ? { opacity: 0.6 } : {})
                  }}
                >
                  ☕ {exporting ? "Wait..." : "Buy me a coffee"}
                </a>
              </div>
            </div>
          </div>
        )}

        {/* ── Mobile Bottom Sheet ───────────────────────────────────────── */}
        <div className="mob-bottom-sheet">
          {/* Tab bar */}
          <div className="mob-tab-bar">
            {["palette", "range", "display", "data", "export"].map((t) => (
              <button
                key={t}
                className={`mob-tab${mobTab === t ? " active" : ""}`}
                onClick={() => setMobTab(t)}
              >
                {t === "palette" ? "PALETTE" : t === "range" ? "RANGE" : t === "display" ? "VIEW" : t === "data" ? "DATA" : "EXPORT"}
              </button>
            ))}
          </div>

          {/* Panel content */}
          <div className="mob-panel">

            {/* PALETTE tab */}
            {mobTab === "palette" && (
              <div>
                {/* Group tabs */}
                <div style={{ display: "flex", gap: 5, marginBottom: 12 }}>
                  {PALETTE_GROUPS.map((g) => (
                    <button key={g} onClick={() => setPaletteGroup(g)} style={{
                      flex: 1, padding: "6px 0", borderRadius: 6, cursor: "pointer",
                      background: paletteGroup === g ? "rgba(255,255,255,0.12)" : "transparent",
                      border: `1px solid ${paletteGroup === g ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.07)"}`,
                      color: paletteGroup === g ? "#fff" : "rgba(255,255,255,0.35)",
                      fontSize: 10, fontWeight: 600, fontFamily: "Inter, sans-serif",
                      letterSpacing: "0.05em",
                    }}>{g}</button>
                  ))}
                </div>
                {/* Swatches */}
                <div className="mob-palette-strip">
                  {PALETTE_KEYS.filter((k) => PALETTES[k].group === paletteGroup).map((k) => {
                    const fn = PALETTES[k].fn;
                    const stops = Array.from({ length: 16 }, (_, i) => fn(i / 15)).join(", ");
                    return (
                      <div key={k} className={`mob-swatch${palette === k ? " active" : ""}`} onClick={() => setPalette(k)}>
                        <div className="mob-swatch-bar" style={{ background: `linear-gradient(to right, ${stops})` }} />
                        <div className="mob-swatch-lbl">{PALETTES[k].label}</div>
                      </div>
                    );
                  })}
                </div>
                {/* Range */}
                <div className="range-labels" style={{ marginTop: 12 }}>
                  <span style={tok.mutedSpan}>{minV != null ? `${minV.toFixed(2)}%` : "—"}</span>
                  <span style={{ ...tok.mutedSpan, fontFamily: '"IBM Plex Mono", monospace', fontSize: 10 }}>yield %</span>
                  <span style={tok.mutedSpan}>{maxV != null ? `${maxV.toFixed(2)}%` : "—"}</span>
                </div>
              </div>
            )}

            {/* RANGE tab */}
            {mobTab === "range" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div>
                  <div style={tok.lbl}>Date Range</div>
                  <div style={{ padding: "0 8px 10px" }}>
                    <Slider
                      range
                      min={2000}
                      max={maxDataYear}
                      value={[startYear, Math.min(endYear, maxDataYear)]}
                      onChange={(val) => { setStartYear(val[0]); setEndYear(val[1]); }}
                      styles={{
                        track: { backgroundColor: '#D4723C' },
                        handle: { borderColor: '#D4723C', backgroundColor: '#FFF', opacity: 1 },
                        rail: { backgroundColor: 'rgba(255,255,255,0.1)' }
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#FFF", fontFamily: '"IBM Plex Mono", monospace' }}>
                    <span>{startYear}</span>
                    <span>{endYear}</span>
                  </div>
                </div>
                <div>
                  <div style={tok.lbl}>Maturity Range</div>
                  <div style={{ padding: "0 8px 10px" }}>
                    <Slider
                      range
                      min={1}
                      max={30}
                      value={[matMin, matMax]}
                      onChange={(val) => { setMatMin(val[0]); setMatMax(val[1]); }}
                      styles={{
                        track: { backgroundColor: '#D4723C' },
                        handle: { borderColor: '#D4723C', backgroundColor: '#FFF', opacity: 1 },
                        rail: { backgroundColor: 'rgba(255,255,255,0.1)' }
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#FFF", fontFamily: '"IBM Plex Mono", monospace' }}>
                    <span>{matMin}Y</span>
                    <span>{matMax}Y</span>
                  </div>
                </div>
              </div>
            )}

            {/* VIEW tab */}
            {mobTab === "display" && (
              <div>
                <div style={tok.lbl}>Display Options</div>
                <div className="toggle-row" onClick={() => setShowLabels((v) => !v)}>
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", fontWeight: 500 }}>Axis Labels</span>
                  <div style={tok.tTrack(showLabels)}><div style={tok.tThumb(showLabels)} /></div>
                </div>
                <div className="toggle-row" onClick={() => { if (showLabels) setShowGrid((v) => !v); }} style={{ opacity: showLabels ? 1 : 0.4, pointerEvents: showLabels ? "auto" : "none" }}>
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", fontWeight: 500 }}>Grid Lines</span>
                  <div style={tok.tTrack(showGrid && showLabels)}><div style={tok.tThumb(showGrid && showLabels)} /></div>
                </div>
              </div>
            )}

            {/* DATA tab */}
            {mobTab === "data" && (
              <div>
                <div style={tok.lbl}>Live Data</div>
                <div style={{ marginBottom: 16, display: "inline-block", padding: "4px 8px", background: "rgba(255,255,255,0.06)", borderRadius: 4, fontSize: 11, fontFamily: '"IBM Plex Mono", monospace', color: "rgba(255,255,255,0.7)" }}>
                  Current: {dataSource}
                </div>
                <p style={{ ...tok.mutedSpan, marginBottom: 14, lineHeight: 1.6 }}>
                  Fetches Bundesbank BBSIS Svensson curve (1–30Y monthly). Falls back to synthetic if unavailable.
                </p>
                {errMsg && <div style={{ ...tok.mutedSpan, color: "#F97316", marginBottom: 10 }}>{errMsg}</div>}
                {loading && (
                  <div style={{ marginBottom: 12 }}>
                    <div className="progress-bar-wrap">
                      <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
                    </div>
                    <span style={tok.mutedSpan}>Fetching… {progress}%</span>
                  </div>
                )}
                <button className="fetch-btn" style={tok.btn} onClick={handleFetch} disabled={loading}>
                  {loading ? `Loading… ${progress}%` : "↓  Fetch Live Data"}
                </button>
              </div>
            )}

            {/* EXPORT tab */}
            {mobTab === "export" && (
              <div>
                <div style={tok.lbl}>Export</div>
                <p style={{ ...tok.mutedSpan, marginBottom: 14 }}>Download chart or data</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
                  <button className="primary-btn" style={{ ...tok.btnPrimary, width: "100%" }} onClick={() => setShowPopup(true)}>
                    ↓  EXPORT PNG
                  </button>
                  <span
                    style={{ ...tok.mutedSpan, fontSize: 13, textDecoration: "underline", cursor: "pointer", opacity: 0.8 }}
                    onClick={executeExportCSV}
                  >
                    Export CSV Data (Matrix)
                  </span>
                </div>
              </div>
            )}

          </div>

          {/* Mobile Footer - Always visible at bottom of sheet */}
          <div style={{
            padding: "12px 20px",
            borderTop: "1px solid rgba(255,255,255,0.05)",
            background: "#0C0D18",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
            textAlign: "center",
            flexShrink: 0,
            paddingBottom: "calc(12px + env(safe-area-inset-bottom))",
          }}>
            <span style={tok.footerSpan}>Made with ❤️ by Julian Hilgemann</span>
            <a
              href="https://www.julianhilgemann.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...tok.footerSpan, color: "rgba(255,255,255,0.25)", textDecoration: "none" }}
            >
              julianhilgemann.com
            </a>
          </div>
        </div>

      </div>
    </>
  );
}