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
// SCHEDULE GENERATOR
// ─────────────────────────────────────────────────────────────────────────────
function generateSchedule({ rental, duration, paymentTerm, deposit, firstRental, startDate }) {
  const isQtr = paymentTerm.includes("quarterly");
  const isAdv = paymentTerm.includes("advance");
  const totalPeriods = isQtr ? Math.ceil(duration / 3) : duration;
  const dep = deposit || 0;
  const fr  = (firstRental != null && firstRental > 0) ? firstRental : null;

  const addMonths = (date, n) => {
    const d = new Date(date);
    d.setMonth(d.getMonth() + n);
    return d;
  };
  const fmtDate = d => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  const rows = [];
  if (dep > 0) {
    rows.push({ period: "—", type: "Security Deposit", dueDate: fmtDate(startDate), amount: dep, note: "Refundable at lease end" });
  }
  for (let i = 0; i < totalPeriods; i++) {
    const amt = (i === 0 && fr !== null) ? fr : rental;
    const isFirst = i === 0 && fr !== null;
    const monthsOffset = isQtr ? i * 3 : i;
    let dueDate;
    if (isAdv) {
      dueDate = addMonths(startDate, monthsOffset);
    } else {
      dueDate = addMonths(startDate, monthsOffset + (isQtr ? 3 : 1));
    }
    rows.push({
      period: i + 1,
      type: isFirst ? "First Period Rental (Stepped)" : "Rental",
      dueDate: fmtDate(dueDate),
      amount: amt,
      note: isAdv ? "Due in advance" : "Due in arrears",
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
const todayStr = () => new Date().toISOString().split("T")[0];

const TERMS = [
  { value: "monthly_advance",   label: "Monthly — Advance"   },
  { value: "monthly_arrears",   label: "Monthly — Arrears"   },
  { value: "quarterly_advance", label: "Quarterly — Advance" },
  { value: "quarterly_arrears", label: "Quarterly — Arrears" },
];

// ─────────────────────────────────────────────────────────────────────────────
// PDF GENERATOR
// ─────────────────────────────────────────────────────────────────────────────
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src; s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(s);
  });
}

async function downloadPDF({ schedule, result, clientName, startDate, term, pLabel }) {
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, M = 14;

  // ── Palette
  const NAVY   = [12, 28, 64];
  const NAVY2  = [30, 55, 110];
  const SLATE  = [80, 100, 130];
  const LGRAY  = [235, 238, 244];
  const WHITE  = [255, 255, 255];
  const MUTED  = [150, 165, 185];
  const GREEN  = [16, 140, 72];
  const GOLD   = [160, 120, 20];

  const dateStr = new Date().toLocaleDateString("en-IN", { day:"2-digit", month:"long", year:"numeric" });
  const startStr = startDate ? new Date(startDate).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" }) : "—";
  const termLabel = TERMS.find(t => t.value === term)?.label || term;
  const totalPayable = schedule.reduce((s, r) => s + r.amount, 0);

  // ─────────────────────────────────────
  // PAGE HEADER  (compact — 28mm tall)
  // ─────────────────────────────────────
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 28, "F");
  // gold accent stripe
  doc.setFillColor(...GOLD);
  doc.rect(0, 25, W, 2.5, "F");

  // Brand left
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...WHITE);
  doc.text("LeasePricer", M, 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text("Equipment Rental — Payment Schedule", M, 19);

  // Date right
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text(dateStr, W - M, 19, { align: "right" });

  // Client name right (large)
  if (clientName) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...WHITE);
    doc.text(clientName, W - M, 12, { align: "right" });
  }

  // ─────────────────────────────────────
  // DEAL SUMMARY  (2-column key-value, compact)
  // ─────────────────────────────────────
  let y = 34;

  // Build summary items in 2 columns × N rows
  const summaryLeft = [
    ["Client",         clientName || "—"],
    ["Asset Cost",     fmt(result.cost)],
    ["Lease Duration", `${result.totalPeriods} ${result.ppy === 12 ? "months" : "quarters"}`],
    ["Payment Terms",  termLabel],
  ];
  const summaryRight = [
    ["Rent Start Date", startStr],
    ["Regular Rental",  fmtD(result.rental)],
    result.firstRental > 0
      ? [`First ${pLabel.charAt(0).toUpperCase()+pLabel.slice(1)} Rental`, fmtD(result.firstRental)]
      : ["Total Periods", String(result.totalPeriods)],
    result.deposit > 0
      ? ["Security Deposit", `${fmt(result.deposit)} (refundable)`]
      : ["Total Payable", fmt(totalPayable)],
  ];

  const rows = Math.max(summaryLeft.length, summaryRight.length);
  const boxH = rows * 8 + 8;
  const colW = (W - M * 2) / 2 - 4;

  doc.setFillColor(...LGRAY);
  doc.roundedRect(M, y, W - M * 2, boxH, 2, 2, "F");

  for (let i = 0; i < rows; i++) {
    const cy = y + 7 + i * 8;

    if (summaryLeft[i]) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(...SLATE);
      doc.text(summaryLeft[i][0], M + 5, cy);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(...NAVY);
      doc.text(summaryLeft[i][1], M + 5 + 36, cy);
    }

    if (summaryRight[i]) {
      const rx = M + colW + 12;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(...SLATE);
      doc.text(summaryRight[i][0], rx, cy);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(...NAVY);
      doc.text(summaryRight[i][1], rx + 36, cy);
    }
  }

  y += boxH + 7;

  // ─────────────────────────────────────
  // SECTION TITLE
  // ─────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...NAVY);
  doc.text("Payment Schedule", M, y);
  // thin rule
  doc.setDrawColor(...LGRAY);
  doc.setLineWidth(0.4);
  doc.line(M + 38, y - 1, W - M, y - 1);
  y += 4;

  // ─────────────────────────────────────
  // SCHEDULE TABLE  — tight rows, no Period column (redundant with #)
  // ─────────────────────────────────────
  const tableBody = schedule.map((row, idx) => {
    const isDeposit = row.period === "—";
    return [
      { content: String(idx + 1), styles: { halign: "center", textColor: SLATE } },
      { content: isDeposit ? "—" : String(row.period), styles: { halign: "center" } },
      { content: row.type, styles: isDeposit ? { textColor: GREEN, fontStyle: "bold" } : {} },
      { content: row.dueDate },
      { content: fmtD(row.amount), styles: { halign: "right", fontStyle: "bold" } },
    ];
  });

  doc.autoTable({
    startY: y,
    head: [[
      { content: "#",          styles: { halign: "center" } },
      { content: "No.",        styles: { halign: "center" } },
      { content: "Description" },
      { content: "Due Date" },
      { content: "Amount (INR)", styles: { halign: "right" } },
    ]],
    body: tableBody,
    foot: [[
      { content: "", colSpan: 3 },
      { content: "TOTAL PAYABLE", styles: { halign: "right", fontStyle: "bold", fontSize: 8, textColor: NAVY } },
      { content: fmtD(totalPayable), styles: { halign: "right", fontStyle: "bold", fontSize: 9, textColor: NAVY } },
    ]],
    margin: { left: M, right: M },
    tableLineColor: LGRAY,
    tableLineWidth: 0,
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: { top: 2.8, bottom: 2.8, left: 4, right: 4 },
      textColor: [30, 45, 70],
      lineColor: LGRAY,
      lineWidth: 0.2,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: NAVY,
      textColor: WHITE,
      fontStyle: "bold",
      fontSize: 7.5,
      cellPadding: { top: 3.5, bottom: 3.5, left: 4, right: 4 },
    },
    footStyles: {
      fillColor: [240, 243, 250],
      textColor: NAVY,
      fontStyle: "bold",
      fontSize: 8,
      cellPadding: { top: 4, bottom: 4, left: 4, right: 4 },
    },
    alternateRowStyles: { fillColor: [249, 250, 252] },
    columnStyles: {
      0: { cellWidth: 9,  halign: "center" },
      1: { cellWidth: 12, halign: "center" },
      2: { cellWidth: "auto" },
      3: { cellWidth: 30 },
      4: { cellWidth: 36, halign: "right" },
    },
    showFoot: "lastPage",
    didDrawPage: (data) => {
      // Repeat compact header on continuation pages
      if (data.pageNumber > 1) {
        doc.setFillColor(...NAVY);
        doc.rect(0, 0, W, 14, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(...WHITE);
        doc.text("LeasePricer", M, 9);
        if (clientName) {
          doc.setFontSize(8);
          doc.text(clientName, W - M, 9, { align: "right" });
        }
        doc.setFillColor(...GOLD);
        doc.rect(0, 12, W, 1.5, "F");
      }
    },
  });

  // ─────────────────────────────────────
  // FOOTER NOTE  (on last page)
  // ─────────────────────────────────────
  const lastY = doc.lastAutoTable.finalY + 6;
  const pageH = 297;
  const noteH = 14;

  // Only draw footer if it fits on the page, otherwise it auto goes to next
  if (lastY + noteH < pageH - 8) {
    doc.setDrawColor(...LGRAY);
    doc.setLineWidth(0.3);
    doc.line(M, lastY, W - M, lastY);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...SLATE);
    doc.text(
      "All amounts are exclusive of applicable taxes unless stated. Security deposit is fully refundable at lease end. Equipment remains the property of the lessor throughout the lease term.",
      M, lastY + 5,
      { maxWidth: W - M * 2 }
    );
    doc.setTextColor(...MUTED);
    doc.text("Confidential — For recipient use only", W / 2, lastY + 12, { align: "center" });
  }

  const safe = clientName ? clientName.replace(/\s+/g, "_") : "Client";
  doc.save(`LeasePricer_${safe}.pdf`);
}

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────────────────
const LIGHT = {
  bg:        "#F8F9FB",
  surface:   "#FFFFFF",
  surface2:  "#F1F3F7",
  border:    "#E2E6EF",
  borderFocus:"#3B5BDB",
  text:      "#0F1729",
  textSec:   "#64748B",
  textMute:  "#94A3B8",
  accent:    "#1E40AF",
  accentBg:  "#EEF2FF",
  accentText:"#1E40AF",
  green:     "#166534",
  greenBg:   "#F0FDF4",
  greenBorder:"#BBF7D0",
  amber:     "#92400E",
  amberBg:   "#FFFBEB",
  amberBorder:"#FDE68A",
  blue:      "#1E3A8A",
  blueBg:    "#EFF6FF",
  blueBorder:"#BFDBFE",
  resultBg:  "#0F1729",
  resultText:"#F8FAFC",
};
const DARK = {
  bg:        "#0A0E1A",
  surface:   "#111827",
  surface2:  "#1C2333",
  border:    "#1E293B",
  borderFocus:"#6366F1",
  text:      "#F1F5F9",
  textSec:   "#94A3B8",
  textMute:  "#475569",
  accent:    "#818CF8",
  accentBg:  "#1E1B4B",
  accentText:"#A5B4FC",
  green:     "#4ADE80",
  greenBg:   "#052E16",
  greenBorder:"#166534",
  amber:     "#FCD34D",
  amberBg:   "#1C1400",
  amberBorder:"#92400E",
  blue:      "#93C5FD",
  blueBg:    "#0C1A3A",
  blueBorder:"#1E3A8A",
  resultBg:  "#1C2333",
  resultText:"#F1F5F9",
};

// ─────────────────────────────────────────────────────────────────────────────
// REUSABLE COMPONENTS  (all defined outside main)
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

const Input = ({ T, dark, ...props }) => {
  const [focused, setFocused] = useState(false);
  return (
    <input {...props}
      onFocus={e => { setFocused(true); props.onFocus && props.onFocus(e); }}
      onBlur={e => { setFocused(false); props.onBlur && props.onBlur(e); }}
      style={{
        width: "100%", padding: "10px 14px", borderRadius: 8,
        border: `1.5px solid ${focused ? T.borderFocus : T.border}`,
        outline: "none", fontSize: 14, fontFamily: "inherit", fontWeight: 500,
        background: T.surface, color: T.text,
        boxShadow: focused ? `0 0 0 3px ${dark ? "rgba(99,102,241,.2)" : "rgba(59,91,219,.1)"}` : "none",
        transition: "border-color .15s, box-shadow .15s",
        boxSizing: "border-box",
        ...props.style,
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
    boxSizing: "border-box", transition: "border-color .15s",
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
      <div style={{
        position: "absolute", top: 2, left: value ? 20 : 2,
        width: 16, height: 16, borderRadius: "50%", background: "#fff",
        boxShadow: "0 1px 3px rgba(0,0,0,.3)", transition: "left .2s",
      }} />
    </div>
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: value ? (color || T.accent) : T.textSec }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: T.textMute, marginTop: 2 }}>{sub}</div>}
    </div>
  </div>
);

const Hint = ({ children, T }) => (
  <div style={{ fontSize: 11, color: T.textMute, marginTop: 6 }}>{children}</div>
);

const Card = ({ children, T, style }) => (
  <div style={{ background: T.surface, borderRadius: 12, border: `1px solid ${T.border}`, padding: "20px 22px", marginBottom: 10, ...style }}>{children}</div>
);

const ResultRow = ({ label, value, muted, T, last }) => (
  <div style={{
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "9px 0", borderBottom: last ? "none" : `1px solid rgba(255,255,255,.08)`,
  }}>
    <span style={{ fontSize: 12, color: muted ? "rgba(255,255,255,.4)" : "rgba(255,255,255,.65)", letterSpacing: ".2px" }}>{label}</span>
    <span style={{ fontSize: 13, color: muted ? "rgba(255,255,255,.5)" : "#F1F5F9", fontWeight: 500 }}>{value}</span>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function RentalPricer() {
  const [dark,        setDark]        = useState(false);
  const [mode,        setMode]        = useState("rental");
  const [cost,        setCost]        = useState("");
  const [duration,    setDuration]    = useState("");
  const [term,        setTerm]        = useState("monthly_advance");
  const [rental,      setRental]      = useState("");
  const [irr,         setIrr]         = useState("24");
  const [resMode,     setResMode]     = useState("pct");
  const [resPct,      setResPct]      = useState("");
  const [resVal,      setResVal]      = useState("");
  const [depMode,     setDepMode]     = useState("pct");
  const [depPct,      setDepPct]      = useState("");
  const [depVal,      setDepVal]      = useState("");
  const [useStep,     setUseStep]     = useState(false);
  const [frMode,      setFrMode]      = useState("pct");
  const [frPct,       setFrPct]       = useState("");
  const [frVal,       setFrVal]       = useState("");
  const [startDate,   setStartDate]   = useState(todayStr());
  const [clientName,  setClientName]  = useState("");
  const [showSched,   setShowSched]   = useState(false);
  const [result,      setResult]      = useState(null);
  const [schedule,    setSchedule]    = useState([]);
  const [error,       setError]       = useState("");
  const [pdfLoading,  setPdfLoading]  = useState(false);

  const T = dark ? DARK : LIGHT;
  const cv = parseFloat(cost) || 0;
  const pLabel = term.includes("quarterly") ? "quarter" : "month";

  const getResidual = () => resMode === "pct" ? (parseFloat(resPct) / 100) * cv : parseFloat(resVal) || 0;
  const getDeposit  = () => depMode === "pct" ? (parseFloat(depPct) / 100) * cv : parseFloat(depVal) || 0;
  const getFirstR   = () => {
    if (!useStep) return null;
    const v = frMode === "pct" ? (parseFloat(frPct) / 100) * cv : parseFloat(frVal) || 0;
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
        const r = solveRental({ cost: c, targetIRR: irrVal, duration: d, paymentTerm: term, residual, deposit: dep, firstRental: fr });
        const { totalPeriods } = buildCashflows({ cost: c, rental: r, duration: d, paymentTerm: term, residual, deposit: dep, firstRental: fr });
        const tot = (fr != null ? fr : 0) + r * (fr != null ? totalPeriods - 1 : totalPeriods);
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
        if (isNaN(ann) || !isFinite(ann)) return setError("Could not converge. Check inputs.");
        const tot = (fr != null ? fr : 0) + r * (fr != null ? totalPeriods - 1 : totalPeriods);
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
    catch (e) { setError("PDF failed. Check internet connection and try again."); }
    setPdfLoading(false);
  };

  const totalPayable = schedule.reduce((s, r) => s + r.amount, 0);

  return (
    <div style={{ fontFamily: "'Inter', 'Helvetica Neue', sans-serif", minHeight: "100vh", background: T.bg, color: T.text, transition: "background .25s, color .25s" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Libre+Baskerville:wght@700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:#CBD5E1;border-radius:2px}
        input::placeholder{color:#94A3B8!important}
        input[type=number]::-webkit-inner-spin-button{opacity:.25}
        input[type=date]::-webkit-calendar-picker-indicator{opacity:.4;cursor:pointer;filter:invert(0)}
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

      <div style={{ maxWidth: 580, margin: "0 auto", padding: "36px 18px 72px" }}>

        {/* ── HEADER ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 36 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: T.accent }} />
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", color: T.textMute }}>Rental Business Tools</span>
            </div>
            <h1 style={{ fontFamily: "'Libre Baskerville', Georgia, serif", fontSize: "2rem", fontWeight: 700, color: T.text, lineHeight: 1.1 }}>
              Lease Pricer
            </h1>
            <p style={{ fontSize: 12, color: T.textMute, marginTop: 5 }}>IRR · Rental · Schedule · PDF Export</p>
          </div>
          <button onClick={() => setDark(v => !v)} style={{
            background: T.surface, border: `1px solid ${T.border}`,
            borderRadius: 8, width: 40, height: 40, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, transition: "all .2s", flexShrink: 0,
          }} title="Toggle theme">{dark ? "☀️" : "🌙"}</button>
        </div>

        {/* ── MODE TABS ── */}
        <Card T={T} style={{ padding: 6, marginBottom: 10 }}>
          <div style={{ display: "flex" }}>
            {[
              { id: "rental", label: "Find Rental", sub: "Target IRR → required rental" },
              { id: "irr",    label: "Find IRR",    sub: "Known rental → achieved IRR"  },
            ].map(m => (
              <button key={m.id} className="mode-tab"
                onClick={() => { setMode(m.id); setResult(null); setError(""); setShowSched(false); }}
                style={{
                  background: mode === m.id ? T.accent : "transparent",
                  color: mode === m.id ? "#fff" : T.textSec,
                  boxShadow: mode === m.id ? "0 2px 8px rgba(0,0,0,.12)" : "none",
                }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{m.label}</div>
                <div style={{ fontSize: 10, fontWeight: 400, opacity: .7, marginTop: 2 }}>{m.sub}</div>
              </button>
            ))}
          </div>
        </Card>

        {/* ── ASSET DETAILS ── */}
        <Card T={T}>
          <SectionLabel T={T}>Asset Details</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div>
              <FieldLabel T={T} right="₹">Asset Cost</FieldLabel>
              <Input T={T} dark={dark} type="number" placeholder="150000" value={cost} onChange={e => setCost(e.target.value)} />
            </div>
            <div>
              <FieldLabel T={T} right="months">Duration</FieldLabel>
              <Input T={T} dark={dark} type="number" placeholder="36" value={duration} onChange={e => setDuration(e.target.value)} />
            </div>
          </div>
          <div>
            <FieldLabel T={T}>Payment Terms</FieldLabel>
            <Select T={T} value={term} onChange={e => setTerm(e.target.value)}>
              {TERMS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </div>
        </Card>

        {/* ── IRR / RENTAL ── */}
        <Card T={T}>
          {mode === "rental" ? (
            <>
              <FieldLabel T={T} right="% per annum">Target IRR</FieldLabel>
              <Input T={T} dark={dark} type="number" placeholder="24" value={irr} onChange={e => setIrr(e.target.value)} />
              {irr && <Hint T={T}>{irr}% annualised return target</Hint>}
            </>
          ) : (
            <>
              <FieldLabel T={T} right="₹">{useStep ? `Regular Rental — ${pLabel} 2 onwards` : `Rental per ${pLabel}`}</FieldLabel>
              <Input T={T} dark={dark} type="number" placeholder="5000" value={rental} onChange={e => setRental(e.target.value)} />
            </>
          )}
        </Card>

        {/* ── RESIDUAL VALUE ── */}
        <Card T={T}>
          <SectionLabel T={T}>Residual Value <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: "none", fontSize: 10, color: T.textMute }}>· internal only, not shown in PDF</span></SectionLabel>
          <SegControl
            options={[{ value: "pct", label: "% of Cost" }, { value: "value", label: "Fixed ₹" }]}
            value={resMode} onChange={setResMode} T={T} colorActive={T.accent}
          />
          <div style={{ marginTop: 12 }}>
            <Input T={T} dark={dark} type="number"
              placeholder={resMode === "pct" ? "e.g. 10 for 10%" : "e.g. 15000"}
              value={resMode === "pct" ? resPct : resVal}
              onChange={e => resMode === "pct" ? setResPct(e.target.value) : setResVal(e.target.value)} />
          </div>
          {cv > 0 && ((resMode === "pct" && resPct) || (resMode === "value" && resVal)) && (
            <Hint T={T}>
              {resMode === "pct" ? `= ${fmt(parseFloat(resPct) / 100 * cv)}` : `= ${(parseFloat(resVal) / cv * 100).toFixed(2)}% of cost`}
            </Hint>
          )}
        </Card>

        {/* ── SECURITY DEPOSIT ── */}
        <div style={{
          background: dark ? T.greenBg : "#F0FDF4",
          border: `1px solid ${T.greenBorder}`,
          borderRadius: 12, padding: "18px 22px", marginBottom: 10,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <SectionLabel T={T} style={{ marginBottom: 0 }}>
              <span style={{ color: dark ? T.green : "#166534", fontSize: 10, fontWeight: 700, letterSpacing: "1.5px" }}>Security Deposit</span>
            </SectionLabel>
            <span style={{ fontSize: 10, fontWeight: 600, color: dark ? T.green : "#166534", background: dark ? "rgba(74,222,128,.12)" : "#DCFCE7", padding: "2px 10px", borderRadius: 20 }}>REFUNDED AT END</span>
          </div>
          <SegControl
            options={[{ value: "pct", label: "% of Cost" }, { value: "value", label: "Fixed ₹" }]}
            value={depMode} onChange={setDepMode} T={T} colorActive={dark ? "#16A34A" : "#15803D"}
          />
          <div style={{ marginTop: 12 }}>
            <Input T={T} dark={dark} type="number"
              placeholder={depMode === "pct" ? "e.g. 10 for 10%" : "e.g. 15000"}
              value={depMode === "pct" ? depPct : depVal}
              onChange={e => depMode === "pct" ? setDepPct(e.target.value) : setDepVal(e.target.value)}
              style={{ borderColor: T.greenBorder }} />
          </div>
          {cv > 0 && ((depMode === "pct" && depPct) || (depMode === "value" && depVal)) && (
            <div style={{ fontSize: 11, color: dark ? T.green : "#166534", marginTop: 7 }}>
              {depMode === "pct"
                ? `= ${fmt(parseFloat(depPct) / 100 * cv)}  ·  net outlay = ${fmt(cv - parseFloat(depPct) / 100 * cv)}`
                : `= ${(parseFloat(depVal) / cv * 100).toFixed(2)}% of cost  ·  net outlay = ${fmt(cv - parseFloat(depVal))}`}
            </div>
          )}
        </div>

        {/* ── STEPPED RENTAL ── */}
        <div style={{
          background: useStep ? (dark ? T.blueBg : "#EFF6FF") : T.surface,
          border: `1px solid ${useStep ? T.blueBorder : T.border}`,
          borderRadius: 12, padding: "18px 22px", marginBottom: 10,
          transition: "all .2s",
        }}>
          <Toggle value={useStep} onChange={v => { setUseStep(v); setResult(null); }}
            label={`Stepped First ${pLabel === "month" ? "Month" : "Quarter"} Rental`}
            sub="Larger upfront, then uniform remaining periods"
            T={T} color={dark ? T.blue : "#1D4ED8"} />
          {useStep && (
            <div style={{ marginTop: 18 }} className="anim-in">
              <div style={{ fontSize: 11, color: dark ? T.blue : "#1D4ED8", background: dark ? "rgba(147,197,253,.08)" : "#DBEAFE", borderRadius: 6, padding: "8px 12px", marginBottom: 14 }}>
                First {pLabel} collected {term.includes("advance") ? "at signing" : "end of period 1"}. Periods 2+ use regular rental above.
              </div>
              <SegControl
                options={[{ value: "pct", label: "% of Cost" }, { value: "value", label: "Fixed ₹" }]}
                value={frMode} onChange={setFrMode} T={T} colorActive={dark ? "#3B82F6" : "#1D4ED8"}
              />
              <div style={{ marginTop: 12 }}>
                <Input T={T} dark={dark} type="number"
                  placeholder={frMode === "pct" ? "e.g. 20 for 20% of cost" : "e.g. 30000"}
                  value={frMode === "pct" ? frPct : frVal}
                  onChange={e => frMode === "pct" ? setFrPct(e.target.value) : setFrVal(e.target.value)}
                  style={{ borderColor: T.blueBorder }} />
              </div>
              {cv > 0 && ((frMode === "pct" && frPct) || (frMode === "value" && frVal)) && (
                <div style={{ fontSize: 11, color: dark ? T.blue : "#1D4ED8", marginTop: 7, lineHeight: 1.8 }}>
                  {(() => {
                    const fr = frMode === "pct" ? (parseFloat(frPct) / 100) * cv : parseFloat(frVal) || 0;
                    const r  = parseFloat(rental) || 0;
                    return <>
                      First {pLabel}: <strong>{fmtD(fr)}</strong>
                      {frMode === "value" ? ` (${(fr/cv*100).toFixed(2)}% of cost)` : ` = ${fmt(fr)}`}
                      {r > 0 && <><br />Uplift vs regular: <strong>+{fmtD(fr-r)}</strong></>}
                    </>;
                  })()}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── SCHEDULE SETTINGS ── */}
        <div style={{ background: dark ? T.amberBg : "#FFFBEB", border: `1px solid ${T.amberBorder}`, borderRadius: 12, padding: "18px 22px", marginBottom: 16 }}>
          <SectionLabel T={T}><span style={{ color: dark ? T.amber : "#92400E" }}>Schedule & PDF Settings</span></SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <FieldLabel T={T}>Rent Start Date</FieldLabel>
              <Input T={T} dark={dark} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ borderColor: T.amberBorder }} />
            </div>
            <div>
              <FieldLabel T={T}>Client Name <span style={{ fontWeight: 400, color: T.textMute }}>(PDF)</span></FieldLabel>
              <Input T={T} dark={dark} type="text" placeholder="e.g. Acme Corp" value={clientName} onChange={e => setClientName(e.target.value)} style={{ borderColor: T.amberBorder }} />
            </div>
          </div>
        </div>

        {/* ── CALCULATE BUTTON ── */}
        <button className="btn-primary" onClick={calculate} style={{
          background: T.accent, color: "#fff", marginBottom: 12,
          boxShadow: `0 4px 14px rgba(30,64,175,.25)`,
        }}>
          Calculate &amp; Generate Schedule
        </button>

        {error && (
          <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "12px 16px", color: "#B91C1C", fontSize: 13, marginBottom: 12, fontWeight: 500 }}>
            {error}
          </div>
        )}

        {/* ── RESULT CARD ── */}
        {result && (
          <div className="anim-in" style={{ borderRadius: 14, overflow: "hidden", marginBottom: 10, boxShadow: "0 8px 32px rgba(0,0,0,.15)" }}>
            {/* Hero */}
            <div style={{ background: dark ? "#1C2333" : "#0F1729", padding: "24px 24px 20px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "2px", color: "rgba(255,255,255,.4)", marginBottom: 8 }}>
                {result.mode === "rental" ? "REQUIRED RENTAL PER PERIOD" : "ACHIEVED IRR"}
              </div>
              <div style={{ fontFamily: "'Libre Baskerville', Georgia, serif", fontSize: "2.8rem", fontWeight: 700, color: "#fff", lineHeight: 1 }}>
                {result.mode === "rental" ? fmtD(result.rental) : fmtPct(result.irr)}
              </div>
              {result.mode === "irr" && (
                <div style={{ fontSize: 12, color: "rgba(255,255,255,.5)", marginTop: 8 }}>
                  {fmtPct(result.periodicRate)} per {result.ppy === 12 ? "month" : "quarter"}
                </div>
              )}
              {result.mode === "rental" && result.firstRental > 0 && (
                <div style={{ fontSize: 12, color: "#93C5FD", marginTop: 8 }}>
                  First {pLabel}: {fmtD(result.firstRental)} · then {fmtD(result.rental)} / {pLabel}
                </div>
              )}
            </div>
            {/* Details */}
            <div style={{ background: dark ? "#141B2C" : "#111827", padding: "4px 24px 16px" }}>
              <ResultRow label="Asset Cost" value={fmt(result.cost)} T={T} />
              {result.deposit > 0 && <ResultRow label="Security Deposit" value={`${fmt(result.deposit)} (${result.depositPct.toFixed(2)}%)`} T={T} />}
              {result.deposit > 0 && <ResultRow label="Net Outlay" value={fmt(result.cost - result.deposit)} T={T} />}
              {result.firstRental > 0 && <ResultRow label={`First ${pLabel.charAt(0).toUpperCase()+pLabel.slice(1)} Rental`} value={fmtD(result.firstRental)} T={T} />}
              <ResultRow label={`Regular Rental / ${pLabel}`} value={fmtD(result.rental)} T={T} />
              <ResultRow label="No. of Periods" value={`${result.totalPeriods} ${result.ppy===12?"months":"quarters"}`} T={T} />
              <ResultRow label="Total Rental Income" value={fmt(result.totalRental)} T={T} />
              <ResultRow label="Residual (internal)" value={`${fmtD(result.residual)} · ${result.residualPct.toFixed(2)}%`} muted T={T} />
              <ResultRow label="Total Recovery" value={fmt(result.totalRental + result.residual - result.deposit)} T={T} last />
            </div>
          </div>
        )}

        {/* ── SCHEDULE TABLE ── */}
        {schedule.length > 0 && (
          <div className="anim-in" style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden", marginBottom: 10 }}>
            <div style={{ padding: "16px 22px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Payment Schedule</div>
                <div style={{ fontSize: 11, color: T.textSec, marginTop: 2 }}>
                  {schedule.length} payments · Total: <strong style={{ color: T.text }}>{fmt(totalPayable)}</strong>
                </div>
              </div>
              <button onClick={() => setShowSched(v => !v)} style={{
                background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8,
                padding: "6px 16px", cursor: "pointer", fontFamily: "inherit",
                fontSize: 12, fontWeight: 600, color: T.textSec, transition: "all .15s",
              }}>{showSched ? "Hide" : "View"}</button>
            </div>

            {showSched && (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: T.surface2 }}>
                      {["#", "Period", "Description", "Due Date", "Amount"].map(h => (
                        <th key={h} style={{ padding: "10px 14px", textAlign: h === "Amount" ? "right" : "left", fontSize: 10, fontWeight: 700, letterSpacing: "1px", color: T.textMute, whiteSpace: "nowrap", borderBottom: `1px solid ${T.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.map((row, i) => (
                      <tr key={i} className="sched-tr" style={{ borderBottom: `1px solid ${T.border}` }}>
                        <td style={{ padding: "10px 14px", color: T.textMute, fontSize: 11 }}>{i+1}</td>
                        <td style={{ padding: "10px 14px", color: T.textSec, fontSize: 11 }}>{row.period}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ color: row.period === "—" ? (dark ? T.green : "#166534") : T.text, fontWeight: row.period === "—" ? 600 : 400 }}>{row.type}</span>
                          {row.period === "—" && <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, color: dark ? T.green : "#166534", background: dark ? "rgba(74,222,128,.1)" : "#DCFCE7", padding: "1px 7px", borderRadius: 20 }}>REFUNDABLE</span>}
                        </td>
                        <td style={{ padding: "10px 14px", color: T.text, whiteSpace: "nowrap" }}>{row.dueDate}</td>
                        <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 600, color: T.text, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fmtD(row.amount)}</td>
                      </tr>
                    ))}
                    <tr style={{ background: dark ? "rgba(30,64,175,.12)" : "#EEF2FF", borderTop: `2px solid ${dark ? "rgba(99,102,241,.3)" : "#C7D2FE"}` }}>
                      <td colSpan={3} />
                      <td style={{ padding: "12px 14px", fontSize: 11, fontWeight: 700, color: dark ? "#A5B4FC" : T.accent, letterSpacing: "1px" }}>TOTAL PAYABLE</td>
                      <td style={{ padding: "12px 14px", textAlign: "right", fontSize: 15, fontWeight: 800, color: dark ? "#A5B4FC" : T.accent, fontVariantNumeric: "tabular-nums" }}>{fmt(totalPayable)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── PDF DOWNLOAD ── */}
        {schedule.length > 0 && (
          <>
            <button className="btn-outline" onClick={handlePDF} style={{
              background: T.surface, border: `1.5px solid ${T.border}`, color: T.text,
              marginBottom: 8, boxShadow: "0 1px 4px rgba(0,0,0,.06)",
            }}>
              <span style={{ fontSize: 16 }}>↓</span>
              {pdfLoading ? "Generating PDF…" : "Download Payment Schedule PDF"}
            </button>
            <div style={{ fontSize: 11, color: T.textMute, textAlign: "center" }}>
              Residual value excluded from PDF · Client-ready document
            </div>
          </>
        )}

      </div>
    </div>
  );
}
