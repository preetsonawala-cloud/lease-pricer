import { useState, useCallback, useRef } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// MATH CORE
// ─────────────────────────────────────────────────────────────────────────────
function npv(rate, cfs) {
  return cfs.reduce((s, cf, i) => s + cf / Math.pow(1 + rate, i), 0);
}
function solveIRR(cfs, guess = 0.01) {
  let r = guess;
  for (let i = 0; i < 300; i++) {
    const f  = npv(r, cfs);
    const df = cfs.reduce((s, cf, t) => s - t * cf / Math.pow(1 + r, t + 1), 0);
    if (Math.abs(df) < 1e-14) break;
    const r2 = r - f / df;
    if (Math.abs(r2 - r) < 1e-12) return r2;
    r = r2;
  }
  return r;
}
function annualIRR(pr, ppy) { return (Math.pow(1 + pr, ppy) - 1) * 100; }

function buildCashflows({ cost, rental, duration, paymentTerm, residual, deposit, firstRental }) {
  const isQtr = paymentTerm.includes("quarterly");
  const isAdv = paymentTerm.includes("advance");
  const totalPeriods = isQtr ? Math.ceil(duration / 3) : duration;
  const ppy = isQtr ? 4 : 12;
  const dep = deposit || 0;
  const fr  = (firstRental != null && firstRental > 0) ? firstRental : null;
  const cfs = new Array(totalPeriods + 1).fill(0);
  cfs[0] = -cost + dep;
  if (isAdv) {
    cfs[0] += fr !== null ? fr : rental;
    for (let i = 1; i < totalPeriods; i++) cfs[i] += rental;
  } else {
    cfs[1] += fr !== null ? fr : rental;
    for (let i = 2; i <= totalPeriods; i++) cfs[i] += rental;
  }
  cfs[totalPeriods] += residual - dep;
  return { cfs, ppy, totalPeriods };
}

function solveRental({ cost, targetIRR, duration, paymentTerm, residual, deposit, firstRental }) {
  const ppy = paymentTerm.includes("quarterly") ? 4 : 12;
  let lo = 0, hi = cost * 2, mid = 0;
  for (let i = 0; i < 300; i++) {
    mid = (lo + hi) / 2;
    const { cfs } = buildCashflows({ cost, rental: mid, duration, paymentTerm, residual, deposit, firstRental });
    const ann = annualIRR(solveIRR(cfs), ppy);
    if (Math.abs(ann - targetIRR) < 0.00005) break;
    if (ann < targetIRR) lo = mid; else hi = mid;
  }
  return mid;
}

// ─────────────────────────────────────────────────────────────────────────────
// DATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const addMonths = (date, n) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
};
const addDays = (date, n) => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
};
const fmtShort = d => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULE GENERATOR — includes period date range in description
// ─────────────────────────────────────────────────────────────────────────────
function generateSchedule({ rental, duration, paymentTerm, deposit, firstRental, startDate }) {
  const isQtr = paymentTerm.includes("quarterly");
  const isAdv = paymentTerm.includes("advance");
  const totalPeriods = isQtr ? Math.ceil(duration / 3) : duration;
  const dep = deposit || 0;
  const fr  = (firstRental != null && firstRental > 0) ? firstRental : null;

  const rows = [];

  // Deposit row
  if (dep > 0) {
    rows.push({
      period: "DEP",
      description: "Security Deposit (refundable at lease end)",
      dueDate: fmtShort(startDate),
      amount: dep,
      isDeposit: true,
    });
  }

  for (let i = 0; i < totalPeriods; i++) {
    const amt      = (i === 0 && fr !== null) ? fr : rental;
    const isFirst  = i === 0 && fr !== null;
    const mOffset  = isQtr ? i * 3 : i;

    // Period start = month i from lease start
    const pStart = addMonths(startDate, mOffset);
    // Period end = day before next period start
    const pEnd   = addDays(addMonths(startDate, mOffset + (isQtr ? 3 : 1)), -1);

    // Due date: advance = period start, arrears = period end + 1 day (= next period start)
    const dueDate = isAdv
      ? addMonths(startDate, mOffset)
      : addMonths(startDate, mOffset + (isQtr ? 3 : 1));

    const label = isFirst ? "First Period Rental" : "Rental";
    rows.push({
      period: i + 1,
      description: `${label}: ${fmtShort(pStart)} - ${fmtShort(pEnd)}`,
      dueDate: fmtShort(dueDate),
      amount: amt,
      isDeposit: false,
    });
  }

  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTERS
// ─────────────────────────────────────────────────────────────────────────────
const fmt    = n => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
const fmtD   = n => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
const fmtPct = n => n.toFixed(4) + "%";
// Plain number with commas — used in PDF to avoid ₹ encoding issues
const fmtNum = n => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n);
const fmtNum0= n => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);

const todayStr = () => new Date().toISOString().split("T")[0];

const TERMS = [
  { value: "monthly_advance",   label: "Monthly — Advance"   },
  { value: "monthly_arrears",   label: "Monthly — Arrears"   },
  { value: "quarterly_advance", label: "Quarterly — Advance" },
  { value: "quarterly_arrears", label: "Quarterly — Arrears" },
];

// ─────────────────────────────────────────────────────────────────────────────
// PDF GENERATOR
// Key fixes:
//   1. Use "Rs." prefix instead of ₹ glyph (jsPDF built-in fonts don't support it)
//   2. Description column shows period date range
//   3. Compact rows — 36+ rows fit on 1 page
//   4. Professional quote-style layout
// ─────────────────────────────────────────────────────────────────────────────
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src; s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed: ${src}`));
    document.head.appendChild(s);
  });
}

async function downloadPDF({ schedule, result, clientName, startDate, term, pLabel }) {
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, M = 12, INNER = W - M * 2;

  // ── Colour palette
  const NAVY    = [13, 27, 62];
  const NAVY2   = [24, 50, 115];
  const SLATE   = [71, 85, 105];
  const LGRAY   = [230, 234, 242];
  const OFFWHT  = [248, 249, 251];
  const WHITE   = [255, 255, 255];
  const MUTED   = [148, 163, 184];
  const GOLD    = [155, 118, 20];
  const GREEN   = [22, 128, 64];
  const GREENLT = [220, 245, 232];

  const dateStr   = new Date().toLocaleDateString("en-IN", { day:"2-digit", month:"long", year:"numeric" });
  const startStr  = startDate ? fmtShort(new Date(startDate)) : "—";
  const termLabel = TERMS.find(t => t.value === term)?.label || term;
  const totalPay  = schedule.reduce((s, r) => s + r.amount, 0);

  // ── Draw page header (reused on every page)
  const drawPageHeader = () => {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, W, 20, "F");
    doc.setFillColor(...GOLD);
    doc.rect(0, 18.5, W, 2, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...WHITE);
    doc.text("LeasePricer", M, 9);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    doc.text("Equipment Rental  |  Payment Schedule", M, 15);
    doc.text(dateStr, W - M, 15, { align: "right" });

    if (clientName) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...WHITE);
      doc.text(clientName, W - M, 9, { align: "right" });
    }
  };

  drawPageHeader();

  // ── Page 1: Deal summary
  let y = 26;

  // Summary box — 3 columns
  const sumItems = [
    { label: "Prepared for",     value: clientName || "—"       },
    { label: "Asset Cost",       value: `Rs. ${fmtNum0(result.cost)}` },
    { label: "Lease Duration",   value: `${result.totalPeriods} ${result.ppy===12?"months":"quarters"}` },
    { label: "Payment Terms",    value: termLabel                },
    { label: "Rent Start Date",  value: startStr                 },
    { label: "Regular Rental",   value: `Rs. ${fmtNum(result.rental)}` },
    ...(result.firstRental > 0 ? [{ label: `First ${pLabel.charAt(0).toUpperCase()+pLabel.slice(1)} Rental`, value: `Rs. ${fmtNum(result.firstRental)}` }] : []),
    ...(result.deposit > 0 ? [{ label: "Security Deposit", value: `Rs. ${fmtNum0(result.deposit)} (refundable)` }] : []),
    { label: "Total Payable",    value: `Rs. ${fmtNum(totalPay)}` },
  ];

  // Arrange into 3 columns
  const COLS = 3;
  const perCol = Math.ceil(sumItems.length / COLS);
  const boxH = perCol * 8 + 7;
  const colW = INNER / COLS;

  doc.setFillColor(...OFFWHT);
  doc.rect(M, y, INNER, boxH, "F");
  doc.setDrawColor(...LGRAY);
  doc.setLineWidth(0.3);
  doc.rect(M, y, INNER, boxH, "S");

  // Vertical dividers
  for (let c = 1; c < COLS; c++) {
    doc.setDrawColor(...LGRAY);
    doc.line(M + c * colW, y + 4, M + c * colW, y + boxH - 4);
  }

  sumItems.forEach((item, idx) => {
    const col = Math.floor(idx / perCol);
    const row = idx % perCol;
    const cx  = M + col * colW + 5;
    const cy  = y + 8 + row * 8;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...SLATE);
    doc.text(item.label, cx, cy - 1);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...NAVY);
    doc.text(item.value, cx, cy + 4, { maxWidth: colW - 8 });
  });

  y += boxH + 6;

  // Section header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...NAVY);
  doc.text("PAYMENT SCHEDULE", M, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  doc.text(`${schedule.length} payment${schedule.length !== 1 ? "s" : ""}  |  Total: Rs. ${fmtNum(totalPay)}`, M + 36, y);
  y += 3;

  // ── Table
  const tableBody = schedule.map(row => {
    const isD = row.isDeposit;
    return [
      { content: String(row.period), styles: { halign: "center", fontStyle: isD ? "bold" : "normal", textColor: isD ? GREEN : SLATE } },
      { content: row.description,    styles: isD ? { textColor: GREEN, fontStyle: "bold" } : { textColor: [30,45,75] } },
      { content: row.dueDate,        styles: { textColor: [30,45,75] } },
      { content: `Rs. ${fmtNum(row.amount)}`, styles: { halign: "right", fontStyle: "bold", textColor: NAVY2 } },
    ];
  });

  doc.autoTable({
    startY: y,
    head: [[
      { content: "No.",         styles: { halign: "center" } },
      { content: "Description" },
      { content: "Due Date" },
      { content: "Amount",      styles: { halign: "right"  } },
    ]],
    body: tableBody,
    foot: [[
      { content: "", colSpan: 2 },
      { content: "TOTAL PAYABLE", styles: { halign: "right", fontStyle: "bold", textColor: NAVY, fontSize: 7.5 } },
      { content: `Rs. ${fmtNum(totalPay)}`, styles: { halign: "right", fontStyle: "bold", textColor: NAVY, fontSize: 8.5 } },
    ]],
    margin: { left: M, right: M, top: 24 },   // top margin for continuation pages
    styles: {
      font: "helvetica",
      fontSize: 7.5,
      cellPadding: { top: 2, bottom: 2, left: 3, right: 3 },
      lineColor: LGRAY,
      lineWidth: 0.2,
      overflow: "ellipsize",
      minCellHeight: 0,
    },
    headStyles: {
      fillColor: NAVY,
      textColor: WHITE,
      fontStyle: "bold",
      fontSize: 7,
      cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
    },
    footStyles: {
      fillColor: [235, 240, 252],
      textColor: NAVY,
      fontStyle: "bold",
      fontSize: 7.5,
      cellPadding: { top: 3.5, bottom: 3.5, left: 3, right: 3 },
    },
    alternateRowStyles: { fillColor: [250, 251, 254] },
    columnStyles: {
      0: { cellWidth: 13, halign: "center" },
      1: { cellWidth: "auto" },
      2: { cellWidth: 26 },
      3: { cellWidth: 36, halign: "right" },
    },
    showFoot: "lastPage",
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        drawPageHeader();
      }
    },
  });

  // ── Footer on last page
  const lastY = doc.lastAutoTable.finalY + 5;
  if (lastY < 287) {
    doc.setDrawColor(...LGRAY);
    doc.setLineWidth(0.25);
    doc.line(M, lastY, W - M, lastY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.2);
    doc.setTextColor(...MUTED);
    doc.text(
      "All amounts are exclusive of applicable taxes unless otherwise stated. Security deposit is fully refundable at lease end upon return of equipment in agreed condition.",
      M, lastY + 4.5, { maxWidth: INNER }
    );
    doc.text(
      "Equipment remains the property of the lessor for the duration of the lease term. This document is for payment reference only.",
      M, lastY + 9, { maxWidth: INNER }
    );
    doc.setFontSize(6);
    doc.setTextColor(200, 205, 215);
    doc.text("Confidential — For recipient use only", W / 2, lastY + 14, { align: "center" });
  }

  const safe = clientName ? clientName.replace(/[^a-zA-Z0-9]/g, "_") : "Client";
  doc.save(`LeasePricer_${safe}.pdf`);
}

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────────────────
const LIGHT = {
  bg: "#F8F9FB", surface: "#FFFFFF", surface2: "#F1F3F7",
  border: "#E2E6EF", borderFocus: "#3B5BDB",
  text: "#0F1729", textSec: "#64748B", textMute: "#94A3B8",
  accent: "#1E40AF", accentBg: "#EEF2FF",
  green: "#166534", greenBg: "#F0FDF4", greenBorder: "#BBF7D0",
  amber: "#92400E", amberBg: "#FFFBEB", amberBorder: "#FDE68A",
  blue: "#1E3A8A", blueBg: "#EFF6FF", blueBorder: "#BFDBFE",
};
const DARK = {
  bg: "#0A0E1A", surface: "#111827", surface2: "#1C2333",
  border: "#1E293B", borderFocus: "#6366F1",
  text: "#F1F5F9", textSec: "#94A3B8", textMute: "#475569",
  accent: "#818CF8", accentBg: "#1E1B4B",
  green: "#4ADE80", greenBg: "#052E16", greenBorder: "#166534",
  amber: "#FCD34D", amberBg: "#1C1400", amberBorder: "#92400E",
  blue: "#93C5FD", blueBg: "#0C1A3A", blueBorder: "#1E3A8A",
};

// ─────────────────────────────────────────────────────────────────────────────
// REUSABLE UI COMPONENTS  (all defined outside main)
// ─────────────────────────────────────────────────────────────────────────────
const SectionLabel = ({ children, T }) => (
  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: T.textMute, marginBottom: 14 }}>{children}</div>
);

const FieldLabel = ({ children, T, right }) => (
  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
    <label style={{ fontSize: 12, fontWeight: 600, color: T.textSec }}>{children}</label>
    {right && <span style={{ fontSize: 11, color: T.textMute }}>{right}</span>}
  </div>
);

const Input = ({ T, dark, accentColor, ...props }) => {
  const [focused, setFocused] = useState(false);
  return (
    <input {...props}
      onFocus={e => { setFocused(true); props.onFocus && props.onFocus(e); }}
      onBlur={e => { setFocused(false); props.onBlur && props.onBlur(e); }}
      style={{
        width: "100%", padding: "10px 14px", borderRadius: 8,
        border: `1.5px solid ${focused ? (accentColor || T.borderFocus) : T.border}`,
        outline: "none", fontSize: 14, fontFamily: "inherit", fontWeight: 500,
        background: T.surface, color: T.text,
        boxShadow: focused ? `0 0 0 3px ${dark ? "rgba(99,102,241,.18)" : "rgba(59,91,219,.1)"}` : "none",
        transition: "border-color .15s, box-shadow .15s",
        boxSizing: "border-box", ...props.style,
      }} />
  );
};

const Select = ({ T, children, ...props }) => (
  <select {...props} style={{
    width: "100%", padding: "10px 14px", borderRadius: 8,
    border: `1.5px solid ${T.border}`, outline: "none",
    fontSize: 14, fontFamily: "inherit", fontWeight: 500,
    background: T.surface, color: T.text, cursor: "pointer",
    appearance: "none",
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2394A3B8' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat", backgroundPosition: "right 14px center",
    boxSizing: "border-box",
  }}>{children}</select>
);

const SegControl = ({ options, value, onChange, T, colorActive }) => (
  <div style={{ display: "flex", background: T.surface2, borderRadius: 8, padding: 3, border: `1px solid ${T.border}`, gap: 2 }}>
    {options.map(opt => {
      const active = value === opt.value;
      return (
        <button key={opt.value} onClick={() => onChange(opt.value)} style={{
          flex: 1, padding: "7px 10px", border: "none", borderRadius: 6,
          cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600,
          transition: "all .15s",
          background: active ? (colorActive || T.accent) : "transparent",
          color: active ? "#fff" : T.textSec,
          boxShadow: active ? "0 1px 4px rgba(0,0,0,.15)" : "none",
        }}>{opt.label}</button>
      );
    })}
  </div>
);

const Toggle = ({ value, onChange, label, sub, T, color }) => (
  <div onClick={() => onChange(!value)} style={{ display: "flex", alignItems: "center", gap: 14, cursor: "pointer", userSelect: "none" }}>
    <div style={{
      width: 44, height: 24, borderRadius: 12, position: "relative",
      background: value ? (color || T.accent) : T.surface2,
      border: `1.5px solid ${value ? (color || T.accent) : T.border}`,
      transition: "all .2s", flexShrink: 0,
    }}>
      <div style={{ position: "absolute", top: 2, left: value ? 20 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.3)", transition: "left .2s" }} />
    </div>
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: value ? (color || T.accent) : T.textSec }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: T.textMute, marginTop: 2 }}>{sub}</div>}
    </div>
  </div>
);

const Card = ({ children, T, style }) => (
  <div style={{ background: T.surface, borderRadius: 12, border: `1px solid ${T.border}`, padding: "20px 22px", marginBottom: 10, ...style }}>{children}</div>
);

const ResultRow = ({ label, value, muted, last }) => (
  <div style={{
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "9px 0", borderBottom: last ? "none" : "1px solid rgba(255,255,255,.07)",
  }}>
    <span style={{ fontSize: 12, color: muted ? "rgba(255,255,255,.38)" : "rgba(255,255,255,.6)", letterSpacing: ".2px" }}>{label}</span>
    <span style={{ fontSize: 13, color: muted ? "rgba(255,255,255,.45)" : "#F1F5F9", fontWeight: 500 }}>{value}</span>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function RentalPricer() {
  const [dark,       setDark]       = useState(false);
  const [mode,       setMode]       = useState("rental");
  const [cost,       setCost]       = useState("");
  const [duration,   setDuration]   = useState("");
  const [term,       setTerm]       = useState("monthly_advance");
  const [rental,     setRental]     = useState("");
  const [irr,        setIrr]        = useState("24");
  const [resMode,    setResMode]    = useState("pct");
  const [resPct,     setResPct]     = useState("");
  const [resVal,     setResVal]     = useState("");
  const [depMode,    setDepMode]    = useState("pct");
  const [depPct,     setDepPct]     = useState("");
  const [depVal,     setDepVal]     = useState("");
  const [useStep,    setUseStep]    = useState(false);
  const [frMode,     setFrMode]     = useState("pct");
  const [frPct,      setFrPct]      = useState("");
  const [frVal,      setFrVal]      = useState("");
  const [startDate,  setStartDate]  = useState(todayStr());
  const [clientName, setClientName] = useState("");
  const [showSched,  setShowSched]  = useState(false);
  const [result,     setResult]     = useState(null);
  const [schedule,   setSchedule]   = useState([]);
  const [error,      setError]      = useState("");
  const [pdfLoading, setPdfLoading] = useState(false);

  const T  = dark ? DARK : LIGHT;
  const cv = parseFloat(cost) || 0;
  const pLabel = term.includes("quarterly") ? "quarter" : "month";

  const getResidual = () => resMode === "pct" ? (parseFloat(resPct)/100)*cv : parseFloat(resVal)||0;
  const getDeposit  = () => depMode === "pct" ? (parseFloat(depPct)/100)*cv : parseFloat(depVal)||0;
  const getFirstR   = () => {
    if (!useStep) return null;
    const v = frMode === "pct" ? (parseFloat(frPct)/100)*cv : parseFloat(frVal)||0;
    return v > 0 ? v : null;
  };

  const calculate = useCallback(() => {
    setError(""); setResult(null); setSchedule([]); setShowSched(false);
    const c   = parseFloat(cost);
    const d   = parseInt(duration);
    const dep = getDeposit();
    const fr  = getFirstR();
    if (!c || !d) return setError("Please enter asset cost and duration.");
    try {
      const ppy = term.includes("quarterly") ? 4 : 12;
      if (mode === "rental") {
        const irrVal = parseFloat(irr);
        if (!irrVal) return setError("Please enter target IRR.");
        const residual = getResidual();
        const r = solveRental({ cost:c, targetIRR:irrVal, duration:d, paymentTerm:term, residual, deposit:dep, firstRental:fr });
        const { totalPeriods } = buildCashflows({ cost:c, rental:r, duration:d, paymentTerm:term, residual, deposit:dep, firstRental:fr });
        const tot = (fr!=null?fr:0) + r*(fr!=null?totalPeriods-1:totalPeriods);
        const res = { mode:"rental", rental:r, irr:irrVal, residual, residualPct:(residual/c)*100, deposit:dep, depositPct:dep>0?(dep/c)*100:0, firstRental:fr, firstRentalPct:fr?(fr/c*100):0, totalPeriods, totalRental:tot, cost:c, ppy };
        setResult(res);
        setSchedule(generateSchedule({ rental:r, duration:d, paymentTerm:term, deposit:dep, firstRental:fr, startDate:new Date(startDate) }));
      } else {
        const r = parseFloat(rental);
        if (!r) return setError("Please enter rental per period.");
        const residual = getResidual();
        const { cfs, totalPeriods } = buildCashflows({ cost:c, rental:r, duration:d, paymentTerm:term, residual, deposit:dep, firstRental:fr });
        const periodicRate = solveIRR(cfs);
        const ann = annualIRR(periodicRate, ppy);
        if (isNaN(ann)||!isFinite(ann)) return setError("Could not converge. Check inputs.");
        const tot = (fr!=null?fr:0) + r*(fr!=null?totalPeriods-1:totalPeriods);
        const res = { mode:"irr", irr:ann, periodicRate:periodicRate*100, ppy, rental:r, residual, residualPct:(residual/c)*100, deposit:dep, depositPct:dep>0?(dep/c)*100:0, firstRental:fr, firstRentalPct:fr?(fr/c*100):0, totalPeriods, totalRental:tot, cost:c };
        setResult(res);
        setSchedule(generateSchedule({ rental:r, duration:d, paymentTerm:term, deposit:dep, firstRental:fr, startDate:new Date(startDate) }));
      }
    } catch { setError("Calculation error. Please check your inputs."); }
  }, [mode, cost, duration, term, rental, irr, resMode, resPct, resVal, depMode, depPct, depVal, useStep, frMode, frPct, frVal, startDate]);

  const handlePDF = async () => {
    if (!result || !schedule.length) return;
    setPdfLoading(true);
    try { await downloadPDF({ schedule, result, clientName, startDate, term, pLabel }); }
    catch (e) { setError("PDF download failed. Please try again."); }
    setPdfLoading(false);
  };

  const totalPayable = schedule.reduce((s, r) => s + r.amount, 0);
  const segOpts = [{ value:"pct", label:"% of Cost" }, { value:"value", label:"Fixed Rs." }];

  return (
    <div style={{ fontFamily:"'Inter','Helvetica Neue',sans-serif", minHeight:"100vh", background:T.bg, color:T.text, transition:"background .25s, color .25s" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Libre+Baskerville:wght@700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:#CBD5E1;border-radius:2px}
        input::placeholder{color:#94A3B8!important}
        input[type=number]::-webkit-inner-spin-button{opacity:.25}
        input[type=date]::-webkit-calendar-picker-indicator{opacity:.4;cursor:pointer}
        select option{background:#fff;color:#0F1729}
        .btn-primary{border:none;width:100%;padding:13px 20px;border-radius:10px;font-family:inherit;font-size:14px;font-weight:600;letter-spacing:.3px;cursor:pointer;transition:all .2s}
        .btn-primary:hover{transform:translateY(-1px);filter:brightness(1.06)}
        .btn-primary:active{transform:translateY(0)}
        .btn-outline{border:none;width:100%;padding:12px 20px;border-radius:10px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;transition:all .2s;display:flex;align-items:center;justify-content:center;gap:8px}
        .btn-outline:hover{transform:translateY(-1px)}
        .mode-tab{flex:1;padding:12px 8px;border:none;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;border-radius:9px;margin:3px;transition:all .2s;text-align:center}
        .anim-in{animation:slideIn .28s cubic-bezier(.16,1,.3,1)}
        @keyframes slideIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        .sched-tr:hover td{background:rgba(59,91,219,.04)!important}
        .sched-tr td{transition:background .1s}
      `}</style>

      <div style={{ maxWidth:580, margin:"0 auto", padding:"36px 18px 72px" }}>

        {/* HEADER */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:32 }}>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
              <div style={{ width:7, height:7, borderRadius:"50%", background:T.accent }} />
              <span style={{ fontSize:10, fontWeight:700, letterSpacing:"2px", textTransform:"uppercase", color:T.textMute }}>Rental Business Tools</span>
            </div>
            <h1 style={{ fontFamily:"'Libre Baskerville',Georgia,serif", fontSize:"1.9rem", fontWeight:700, color:T.text, lineHeight:1.1 }}>Lease Pricer</h1>
            <p style={{ fontSize:12, color:T.textMute, marginTop:5 }}>IRR · Rental · Schedule · PDF Export</p>
          </div>
          <button onClick={() => setDark(v=>!v)} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, width:40, height:40, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, transition:"all .2s", flexShrink:0 }}>
            {dark?"☀️":"🌙"}
          </button>
        </div>

        {/* MODE TABS */}
        <Card T={T} style={{ padding:6 }}>
          <div style={{ display:"flex" }}>
            {[
              { id:"rental", label:"Find Rental", sub:"Target IRR → required rental" },
              { id:"irr",    label:"Find IRR",    sub:"Known rental → achieved IRR"  },
            ].map(m => (
              <button key={m.id} className="mode-tab"
                onClick={() => { setMode(m.id); setResult(null); setError(""); setShowSched(false); }}
                style={{ background:mode===m.id?T.accent:"transparent", color:mode===m.id?"#fff":T.textSec, boxShadow:mode===m.id?"0 2px 8px rgba(0,0,0,.12)":"none" }}>
                <div style={{ fontWeight:700, fontSize:13 }}>{m.label}</div>
                <div style={{ fontSize:10, fontWeight:400, opacity:.7, marginTop:2 }}>{m.sub}</div>
              </button>
            ))}
          </div>
        </Card>

        {/* ASSET DETAILS */}
        <Card T={T}>
          <SectionLabel T={T}>Asset Details</SectionLabel>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
            <div>
              <FieldLabel T={T} right="Rs.">Asset Cost</FieldLabel>
              <Input T={T} dark={dark} type="number" placeholder="150000" value={cost} onChange={e=>setCost(e.target.value)} />
            </div>
            <div>
              <FieldLabel T={T} right="months">Duration</FieldLabel>
              <Input T={T} dark={dark} type="number" placeholder="36" value={duration} onChange={e=>setDuration(e.target.value)} />
            </div>
          </div>
          <FieldLabel T={T}>Payment Terms</FieldLabel>
          <Select T={T} value={term} onChange={e=>setTerm(e.target.value)}>
            {TERMS.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Card>

        {/* IRR / RENTAL */}
        <Card T={T}>
          {mode === "rental" ? (
            <>
              <FieldLabel T={T} right="% per annum">Target IRR</FieldLabel>
              <Input T={T} dark={dark} type="number" placeholder="24" value={irr} onChange={e=>setIrr(e.target.value)} />
              {irr && <div style={{ fontSize:11, color:T.accent, marginTop:6, fontWeight:500 }}>{irr}% annualised return target</div>}
            </>
          ) : (
            <>
              <FieldLabel T={T} right="Rs.">{useStep?`Regular Rental — ${pLabel} 2 onwards`:`Rental per ${pLabel}`}</FieldLabel>
              <Input T={T} dark={dark} type="number" placeholder="5000" value={rental} onChange={e=>setRental(e.target.value)} />
            </>
          )}
        </Card>

        {/* RESIDUAL */}
        <Card T={T}>
          <SectionLabel T={T}>Residual Value <span style={{ fontWeight:400, letterSpacing:0, textTransform:"none", fontSize:10 }}>· internal only, not in PDF</span></SectionLabel>
          <SegControl options={segOpts} value={resMode} onChange={setResMode} T={T} colorActive={T.accent} />
          <div style={{ marginTop:12 }}>
            <Input T={T} dark={dark} type="number"
              placeholder={resMode==="pct"?"e.g. 10 for 10%":"e.g. 15000"}
              value={resMode==="pct"?resPct:resVal}
              onChange={e=>resMode==="pct"?setResPct(e.target.value):setResVal(e.target.value)} />
          </div>
          {cv>0 && ((resMode==="pct"&&resPct)||(resMode==="value"&&resVal)) && (
            <div style={{ fontSize:11, color:T.accent, marginTop:7, fontWeight:500 }}>
              {resMode==="pct"?`= ${fmt(parseFloat(resPct)/100*cv)}`:`= ${(parseFloat(resVal)/cv*100).toFixed(2)}% of cost`}
            </div>
          )}
        </Card>

        {/* SECURITY DEPOSIT */}
        <div style={{ background:dark?T.greenBg:"#F0FDF4", border:`1px solid ${T.greenBorder}`, borderRadius:12, padding:"18px 22px", marginBottom:10 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
            <span style={{ fontSize:10, fontWeight:700, letterSpacing:"1.5px", color:dark?T.green:"#166534" }}>SECURITY DEPOSIT</span>
            <span style={{ fontSize:10, fontWeight:600, color:dark?T.green:"#166534", background:dark?"rgba(74,222,128,.12)":"#DCFCE7", padding:"2px 10px", borderRadius:20 }}>REFUNDED AT END</span>
          </div>
          <SegControl options={segOpts} value={depMode} onChange={setDepMode} T={T} colorActive={dark?"#16A34A":"#15803D"} />
          <div style={{ marginTop:12 }}>
            <Input T={T} dark={dark} accentColor={dark?T.green:"#15803D"} type="number"
              placeholder={depMode==="pct"?"e.g. 10 for 10%":"e.g. 15000"}
              value={depMode==="pct"?depPct:depVal}
              onChange={e=>depMode==="pct"?setDepPct(e.target.value):setDepVal(e.target.value)}
              style={{ borderColor:T.greenBorder }} />
          </div>
          {cv>0 && ((depMode==="pct"&&depPct)||(depMode==="value"&&depVal)) && (
            <div style={{ fontSize:11, color:dark?T.green:"#166534", marginTop:7 }}>
              {depMode==="pct"
                ?`= ${fmt(parseFloat(depPct)/100*cv)}  ·  net outlay = ${fmt(cv-parseFloat(depPct)/100*cv)}`
                :`= ${(parseFloat(depVal)/cv*100).toFixed(2)}% of cost  ·  net outlay = ${fmt(cv-parseFloat(depVal))}`}
            </div>
          )}
        </div>

        {/* STEPPED RENTAL */}
        <div style={{ background:useStep?(dark?T.blueBg:"#EFF6FF"):T.surface, border:`1px solid ${useStep?T.blueBorder:T.border}`, borderRadius:12, padding:"18px 22px", marginBottom:10, transition:"all .2s" }}>
          <Toggle value={useStep} onChange={v=>{setUseStep(v);setResult(null);}}
            label={`Stepped First ${pLabel==="month"?"Month":"Quarter"} Rental`}
            sub="Larger upfront, then uniform remaining periods"
            T={T} color={dark?T.blue:"#1D4ED8"} />
          {useStep && (
            <div style={{ marginTop:18 }} className="anim-in">
              <div style={{ fontSize:11, color:dark?T.blue:"#1D4ED8", background:dark?"rgba(147,197,253,.08)":"#DBEAFE", borderRadius:6, padding:"8px 12px", marginBottom:14 }}>
                First {pLabel} collected {term.includes("advance")?"at signing":"end of period 1"}. Periods 2+ use the regular rental.
              </div>
              <SegControl options={segOpts} value={frMode} onChange={setFrMode} T={T} colorActive={dark?"#3B82F6":"#1D4ED8"} />
              <div style={{ marginTop:12 }}>
                <Input T={T} dark={dark} accentColor={dark?T.blue:"#1D4ED8"} type="number"
                  placeholder={frMode==="pct"?"e.g. 20 for 20% of cost":"e.g. 30000"}
                  value={frMode==="pct"?frPct:frVal}
                  onChange={e=>frMode==="pct"?setFrPct(e.target.value):setFrVal(e.target.value)}
                  style={{ borderColor:T.blueBorder }} />
              </div>
            </div>
          )}
        </div>

        {/* SCHEDULE SETTINGS */}
        <div style={{ background:dark?T.amberBg:"#FFFBEB", border:`1px solid ${T.amberBorder}`, borderRadius:12, padding:"18px 22px", marginBottom:16 }}>
          <SectionLabel T={T}><span style={{ color:dark?T.amber:"#92400E" }}>Schedule & PDF</span></SectionLabel>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            <div>
              <FieldLabel T={T}>Rent Start Date</FieldLabel>
              <Input T={T} dark={dark} accentColor={dark?T.amber:"#D97706"} type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} style={{ borderColor:T.amberBorder }} />
            </div>
            <div>
              <FieldLabel T={T}>Client Name <span style={{ fontWeight:400, color:T.textMute }}>(PDF)</span></FieldLabel>
              <Input T={T} dark={dark} accentColor={dark?T.amber:"#D97706"} type="text" placeholder="e.g. Tata Motors" value={clientName} onChange={e=>setClientName(e.target.value)} style={{ borderColor:T.amberBorder }} />
            </div>
          </div>
        </div>

        {/* CALCULATE */}
        <button className="btn-primary" onClick={calculate} style={{ background:T.accent, color:"#fff", marginBottom:12, boxShadow:`0 4px 14px rgba(30,64,175,.25)` }}>
          Calculate &amp; Generate Schedule
        </button>

        {error && (
          <div style={{ background:"#FEF2F2", border:"1px solid #FECACA", borderRadius:10, padding:"12px 16px", color:"#B91C1C", fontSize:13, marginBottom:12, fontWeight:500 }}>
            {error}
          </div>
        )}

        {/* RESULT SUMMARY */}
        {result && (
          <div className="anim-in" style={{ borderRadius:14, overflow:"hidden", marginBottom:10, boxShadow:"0 8px 32px rgba(0,0,0,.15)" }}>
            <div style={{ background:dark?"#1C2333":"#0F1729", padding:"24px 24px 18px" }}>
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:"2px", color:"rgba(255,255,255,.38)", marginBottom:8 }}>
                {result.mode==="rental"?"REQUIRED RENTAL PER PERIOD":"ACHIEVED IRR"}
              </div>
              <div style={{ fontFamily:"'Libre Baskerville',Georgia,serif", fontSize:"2.8rem", fontWeight:700, color:"#fff", lineHeight:1 }}>
                {result.mode==="rental"?fmtD(result.rental):fmtPct(result.irr)}
              </div>
              {result.mode==="irr" && <div style={{ fontSize:12, color:"rgba(255,255,255,.45)", marginTop:8 }}>{fmtPct(result.periodicRate)} per {result.ppy===12?"month":"quarter"}</div>}
              {result.mode==="rental" && result.firstRental>0 && <div style={{ fontSize:12, color:"#93C5FD", marginTop:8 }}>First {pLabel}: {fmtD(result.firstRental)} · then {fmtD(result.rental)} / {pLabel}</div>}
            </div>
            <div style={{ background:dark?"#141B2C":"#111827", padding:"4px 24px 16px" }}>
              <ResultRow label="Asset Cost"          value={fmt(result.cost)} />
              {result.deposit>0 && <ResultRow label="Security Deposit" value={`${fmt(result.deposit)} (${result.depositPct.toFixed(2)}%)`} />}
              {result.deposit>0 && <ResultRow label="Net Outlay"       value={fmt(result.cost-result.deposit)} />}
              {result.firstRental>0 && <ResultRow label={`First ${pLabel.charAt(0).toUpperCase()+pLabel.slice(1)} Rental`} value={fmtD(result.firstRental)} />}
              <ResultRow label={`Regular Rental / ${pLabel}`} value={fmtD(result.rental)} />
              <ResultRow label="No. of Periods"       value={`${result.totalPeriods} ${result.ppy===12?"months":"quarters"}`} />
              <ResultRow label="Total Rental Income"  value={fmt(result.totalRental)} />
              <ResultRow label="Residual (internal)"  value={`${fmtD(result.residual)} · ${result.residualPct.toFixed(2)}%`} muted />
              <ResultRow label="Total Recovery"       value={fmt(result.totalRental+result.residual-result.deposit)} last />
            </div>
          </div>
        )}

        {/* SCHEDULE TABLE */}
        {schedule.length>0 && (
          <div className="anim-in" style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:14, overflow:"hidden", marginBottom:10 }}>
            <div style={{ padding:"16px 22px", borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:T.text }}>Payment Schedule</div>
                <div style={{ fontSize:11, color:T.textSec, marginTop:2 }}>
                  {schedule.length} payments · Total: <strong style={{ color:T.text }}>{fmt(totalPayable)}</strong>
                </div>
              </div>
              <button onClick={()=>setShowSched(v=>!v)} style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:8, padding:"6px 16px", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:600, color:T.textSec }}>
                {showSched?"Hide":"View"}
              </button>
            </div>
            {showSched && (
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                  <thead>
                    <tr style={{ background:T.surface2 }}>
                      {["No.","Description","Due Date","Amount"].map(h=>(
                        <th key={h} style={{ padding:"10px 12px", textAlign:h==="Amount"?"right":"left", fontSize:10, fontWeight:700, letterSpacing:"1px", color:T.textMute, whiteSpace:"nowrap", borderBottom:`1px solid ${T.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.map((row,i)=>(
                      <tr key={i} className="sched-tr" style={{ borderBottom:`1px solid ${T.border}` }}>
                        <td style={{ padding:"9px 12px", color:row.isDeposit?(dark?T.green:"#166534"):T.textSec, fontSize:11, fontWeight:row.isDeposit?700:400 }}>{row.period}</td>
                        <td style={{ padding:"9px 12px", color:row.isDeposit?(dark?T.green:"#166534"):T.text, fontWeight:row.isDeposit?600:400 }}>{row.description}</td>
                        <td style={{ padding:"9px 12px", color:T.text, whiteSpace:"nowrap" }}>{row.dueDate}</td>
                        <td style={{ padding:"9px 12px", textAlign:"right", fontWeight:600, color:T.text, whiteSpace:"nowrap" }}>{fmtD(row.amount)}</td>
                      </tr>
                    ))}
                    <tr style={{ background:dark?"rgba(30,64,175,.12)":"#EEF2FF", borderTop:`2px solid ${dark?"rgba(99,102,241,.3)":"#C7D2FE"}` }}>
                      <td colSpan={2} />
                      <td style={{ padding:"12px", fontSize:11, fontWeight:700, color:dark?"#A5B4FC":T.accent, letterSpacing:"1px" }}>TOTAL PAYABLE</td>
                      <td style={{ padding:"12px", textAlign:"right", fontSize:15, fontWeight:800, color:dark?"#A5B4FC":T.accent }}>{fmt(totalPayable)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* PDF DOWNLOAD */}
        {schedule.length>0 && (
          <>
            <button className="btn-outline" onClick={handlePDF} style={{ background:T.surface, border:`1.5px solid ${T.border}`, color:T.text, marginBottom:8, boxShadow:"0 1px 4px rgba(0,0,0,.06)" }}>
              <span style={{ fontSize:16 }}>↓</span>
              {pdfLoading?"Generating PDF…":"Download Payment Schedule PDF"}
            </button>
            <div style={{ fontSize:11, color:T.textMute, textAlign:"center" }}>Residual value excluded from PDF · Client-ready document</div>
          </>
        )}

      </div>
    </div>
  );
}
