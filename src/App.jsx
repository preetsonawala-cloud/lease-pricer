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

  // Deposit row
  if (dep > 0) {
    rows.push({ period: "—", type: "Security Deposit", dueDate: fmtDate(startDate), amount: dep, note: "Refundable at lease end" });
  }

  for (let i = 0; i < totalPeriods; i++) {
    const periodNum = i + 1;
    const amt = (i === 0 && fr !== null) ? fr : rental;
    const isFirst = i === 0 && fr !== null;
    const monthsOffset = isQtr ? i * 3 : i;

    let dueDate;
    if (isAdv) {
      dueDate = addMonths(startDate, monthsOffset);
    } else {
      dueDate = addMonths(startDate, monthsOffset + (isQtr ? 3 : 1));
    }

    const periodLabel = isQtr
      ? `Q${periodNum} (${fmtDate(addMonths(startDate, monthsOffset))} – ${fmtDate(addMonths(addMonths(startDate, monthsOffset), 3))})`
      : `Month ${periodNum}`;

    rows.push({
      period: periodNum,
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
  { value: "monthly_advance",   label: "Monthly Advance"   },
  { value: "monthly_arrears",   label: "Monthly Arrears"   },
  { value: "quarterly_advance", label: "Quarterly Advance" },
  { value: "quarterly_arrears", label: "Quarterly Arrears" },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
const Pill = ({ active, onClick, children, colors }) => (
  <button onClick={onClick} style={{
    flex: 1, padding: "8px 6px", border: "none", cursor: "pointer",
    fontFamily: "inherit", fontSize: 12, fontWeight: 600, letterSpacing: ".4px",
    borderRadius: 8, margin: 3, transition: "all .2s",
    background: active ? colors.activeBg : "transparent",
    color: active ? colors.activeText : colors.inactiveText,
    boxShadow: active ? colors.shadow : "none",
  }}>{children}</button>
);

const StyledInput = ({ dark, accentColor, ...props }) => (
  <input {...props} style={{
    width: "100%", padding: "12px 16px", borderRadius: 10,
    border: `1.5px solid ${dark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.1)"}`,
    outline: "none", fontSize: 15, fontFamily: "inherit", fontWeight: 500,
    transition: "border-color .2s, box-shadow .2s", boxSizing: "border-box",
    background: dark ? "rgba(255,255,255,.04)" : "rgba(0,0,0,.03)",
    color: dark ? "#f2f2f2" : "#111",
    ...props.style,
  }}
  onFocus={e => { e.target.style.borderColor = accentColor; e.target.style.boxShadow = `0 0 0 3px ${accentColor}22`; }}
  onBlur={e => { e.target.style.borderColor = dark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.1)"; e.target.style.boxShadow = "none"; }}
  />
);

const StyledSelect = ({ dark, children, ...props }) => (
  <select {...props} style={{
    width: "100%", padding: "12px 16px", borderRadius: 10,
    border: `1.5px solid ${dark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.1)"}`,
    outline: "none", fontSize: 15, fontFamily: "inherit", fontWeight: 500,
    background: dark ? "rgba(255,255,255,.04)" : "rgba(0,0,0,.03)",
    color: dark ? "#f2f2f2" : "#111", cursor: "pointer",
    boxSizing: "border-box", appearance: "none",
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23888' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat", backgroundPosition: "right 14px center",
  }}>{children}</select>
);

const ResultLine = ({ label, value, bold, accent, dark, separator }) => (
  <div style={{
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: separator ? "14px 0" : "9px 0",
    borderTop: separator ? `1px solid ${dark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.08)"}` : "none",
  }}>
    <span style={{ fontSize: 12, color: accent ? "#e8b000" : (dark ? "#777" : "#aaa"), letterSpacing: ".3px", fontWeight: bold ? 600 : 400 }}>{label}</span>
    <span style={{ fontSize: bold ? 15 : 13, color: accent ? "#e8b000" : (dark ? "#e8e8e8" : "#111"), fontWeight: bold ? 700 : 500 }}>{value}</span>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// PDF GENERATOR  (pure browser, uses jsPDF from CDN)
// ─────────────────────────────────────────────────────────────────────────────
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(s);
  });
}

async function downloadPDF({ schedule, result, clientName, startDate, term, pLabel }) {
  // Load jsPDF core first, then autotable plugin sequentially
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, margin = 18;

  // ── Colours
  const gold   = [200, 150, 0];
  const dark1  = [20, 20, 20];
  const dark2  = [50, 50, 50];
  const light  = [245, 244, 240];
  const white  = [255, 255, 255];
  const green  = [34, 170, 100];

  // ── Header band
  doc.setFillColor(...dark1);
  doc.rect(0, 0, W, 38, "F");
  doc.setFillColor(...gold);
  doc.rect(0, 35, W, 3, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...white);
  doc.text("LeasePricer", margin, 16);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(180, 180, 180);
  doc.text("Payment Schedule", margin, 24);
  doc.text(`Generated: ${new Date().toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" })}`, margin, 30);

  // Client name right side
  if (clientName) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...white);
    doc.text(`Prepared for: ${clientName}`, W - margin, 16, { align: "right" });
  }

  let y = 50;

  // ── Summary box
  doc.setFillColor(...light);
  doc.roundedRect(margin, y, W - margin * 2, 38, 4, 4, "F");

  const summaryItems = [
    ["Asset Cost",     fmt(result.cost)],
    ["Lease Duration", `${result.totalPeriods} ${result.ppy === 12 ? "months" : "quarters"}`],
    ["Payment Terms",  TERMS.find(t => t.value === term)?.label || term],
    ["Rental / Period",fmtD(result.rental)],
    result.firstRental > 0
      ? [`First ${pLabel} Rental`, fmtD(result.firstRental)]
      : null,
    result.deposit > 0
      ? ["Security Deposit", `${fmt(result.deposit)} (refundable)`]
      : null,
    ["Start Date",     startDate ? new Date(startDate).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" }) : "—"],
  ].filter(Boolean);

  const colW = (W - margin * 2) / 2;
  let sx = margin + 8, sy = y + 10;
  summaryItems.forEach(([label, value], i) => {
    const cx = i % 2 === 0 ? margin + 8 : margin + 8 + colW;
    const cy = sy + Math.floor(i / 2) * 10;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...dark2);
    doc.text(label + ":", cx, cy);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...dark1);
    doc.text(value, cx + 38, cy);
  });

  y += 48;

  // ── Section title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...dark1);
  doc.text("Payment Schedule", margin, y);
  y += 8;

  // ── Table
  const tableRows = schedule.map((row, idx) => [
    idx + 1,
    row.period === "—" ? "Deposit" : `${row.period}`,
    row.type,
    row.dueDate,
    fmtD(row.amount),
    row.note,
  ]);

  const totalPayable = schedule.reduce((s, r) => s + r.amount, 0);

  doc.autoTable({
    startY: y,
    head: [["#", "Period", "Description", "Due Date", "Amount (₹)", "Note"]],
    body: tableRows,
    foot: [["", "", "", "TOTAL PAYABLE", fmtD(totalPayable), ""]],
    margin: { left: margin, right: margin },
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 4, textColor: dark1, lineColor: [220, 218, 212], lineWidth: 0.3 },
    headStyles: { fillColor: dark1, textColor: white, fontStyle: "bold", fontSize: 8.5 },
    footStyles: { fillColor: [...gold, 40], textColor: dark1, fontStyle: "bold", fontSize: 9 },
    alternateRowStyles: { fillColor: [250, 249, 246] },
    columnStyles: {
      0: { halign: "center", cellWidth: 8 },
      1: { cellWidth: 16 },
      2: { cellWidth: 48 },
      3: { cellWidth: 30 },
      4: { halign: "right", cellWidth: 32, fontStyle: "bold" },
      5: { cellWidth: 38, textColor: [120, 120, 120], fontSize: 7.5 },
    },
    didDrawCell: (data) => {
      if (data.section === "body" && data.column.index === 4) {
        // highlight deposit row green
        const row = schedule[data.row.index];
        if (row && row.period === "—") {
          doc.setTextColor(...green);
        }
      }
    },
  });

  const finalY = doc.lastAutoTable.finalY + 10;

  // ── Note at bottom
  doc.setFillColor(...light);
  doc.roundedRect(margin, finalY, W - margin * 2, 16, 3, 3, "F");
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  doc.setTextColor(120, 120, 120);
  doc.text("Note: All amounts are exclusive of GST unless stated. Security deposit is fully refundable at lease end. This schedule is for payment reference only.", margin + 6, finalY + 6);
  doc.text("Equipment remains the property of the lessor throughout the lease term.", margin + 6, finalY + 12);

  // ── Footer
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(180, 180, 180);
  doc.text("Confidential — For recipient use only", W / 2, 292, { align: "center" });

  const safeClient = clientName ? clientName.replace(/\s+/g, "_") : "Client";
  doc.save(`LeasePricer_Schedule_${safeClient}.pdf`);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function RentalPricer() {
  const [dark,      setDark]      = useState(true);
  const [mode,      setMode]      = useState("rental");
  const [cost,      setCost]      = useState("");
  const [duration,  setDuration]  = useState("");
  const [term,      setTerm]      = useState("monthly_advance");
  const [rental,    setRental]    = useState("");
  const [irr,       setIrr]       = useState("24");
  const [resMode,   setResMode]   = useState("pct");
  const [resPct,    setResPct]    = useState("");
  const [resVal,    setResVal]    = useState("");
  const [depMode,   setDepMode]   = useState("pct");
  const [depPct,    setDepPct]    = useState("");
  const [depVal,    setDepVal]    = useState("");
  const [useStep,   setUseStep]   = useState(false);
  const [frMode,    setFrMode]    = useState("pct");
  const [frPct,     setFrPct]     = useState("");
  const [frVal,     setFrVal]     = useState("");
  // Schedule
  const [startDate,   setStartDate]   = useState(todayStr());
  const [clientName,  setClientName]  = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [result,   setResult]   = useState(null);
  const [schedule, setSchedule] = useState([]);
  const [error,    setError]    = useState("");
  const [pdfLoading, setPdfLoading] = useState(false);
  const scheduleRef = useRef(null);

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
    setError(""); setResult(null); setSchedule([]); setShowSchedule(false);
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
        const normalPeriods = fr != null ? totalPeriods - 1 : totalPeriods;
        const tot = (fr != null ? fr : 0) + r * normalPeriods;
        const res = { mode: "rental", rental: r, irr: irrVal, residual, residualPct: (residual / c) * 100, deposit: dep, depositPct: dep > 0 ? (dep / c) * 100 : 0, firstRental: fr, firstRentalPct: fr ? (fr / c * 100) : 0, totalPeriods, totalRental: tot, cost: c, ppy };
        setResult(res);
        const sched = generateSchedule({ rental: r, duration: d, paymentTerm: term, deposit: dep, firstRental: fr, startDate: new Date(startDate) });
        setSchedule(sched);
      } else {
        const r = parseFloat(rental);
        if (!r) return setError("Please enter rental per period.");
        const residual = getResidual();
        const { cfs, totalPeriods } = buildCashflows({ cost: c, rental: r, duration: d, paymentTerm: term, residual, deposit: dep, firstRental: fr });
        const periodicRate = solveIRR(cfs);
        const ann = annualIRR(periodicRate, ppy);
        if (isNaN(ann) || !isFinite(ann)) return setError("Could not converge. Check your inputs.");
        const normalPeriods = fr != null ? totalPeriods - 1 : totalPeriods;
        const tot = (fr != null ? fr : 0) + r * normalPeriods;
        const res = { mode: "irr", irr: ann, periodicRate: periodicRate * 100, ppy, rental: r, residual, residualPct: (residual / c) * 100, deposit: dep, depositPct: dep > 0 ? (dep / c) * 100 : 0, firstRental: fr, firstRentalPct: fr ? (fr / c * 100) : 0, totalPeriods, totalRental: tot, cost: c };
        setResult(res);
        const sched = generateSchedule({ rental: r, duration: d, paymentTerm: term, deposit: dep, firstRental: fr, startDate: new Date(startDate) });
        setSchedule(sched);
      }
    } catch { setError("Calculation error. Please check your inputs."); }
  }, [mode, cost, duration, term, rental, irr, resMode, resPct, resVal, depMode, depPct, depVal, useStep, frMode, frPct, frVal, startDate]);

  const handleDownloadPDF = async () => {
    if (!result || !schedule.length) return;
    setPdfLoading(true);
    try {
      await downloadPDF({ schedule, result, clientName, startDate, term, pLabel });
    } catch (e) {
      console.error("PDF error:", e);
      setError("PDF download failed. Please check your internet connection and try again.");
    }
    setPdfLoading(false);
  };

  // ── Theme
  const T = {
    bg:       dark ? "#0d0d0d" : "#f0efe9",
    surface:  dark ? "#161616" : "#ffffff",
    surface2: dark ? "#1c1c1c" : "#f7f6f2",
    border:   dark ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.08)",
    text:     dark ? "#f0f0f0" : "#111111",
    textSec:  dark ? "#666666" : "#aaaaaa",
    accent:   "#e8b000",
    green:    "#2ec27e",
    greenSoft:"rgba(46,194,126,.12)",
    blue:     "#5b8def",
    blueSoft: "rgba(91,141,239,.12)",
  };

  const pillColors = { activeBg: T.accent, activeText: "#111", inactiveText: T.textSec, shadow: `0 2px 10px rgba(232,176,0,.3)` };
  const segStyle = { display: "flex", background: T.surface2, borderRadius: 11, padding: 3, border: `1px solid ${T.border}` };
  const cardStyle = { background: T.surface, borderRadius: 18, border: `1px solid ${T.border}`, padding: "20px 22px", marginBottom: 12 };

  const totalPayable = schedule.reduce((s, r) => s + r.amount, 0);

  return (
    <div style={{ fontFamily: "'DM Sans','Helvetica Neue',sans-serif", minHeight: "100vh", background: T.bg, color: T.text, transition: "background .3s" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&family=Syne:wght@700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#333;border-radius:2px}
        input::placeholder{color:#555}input[type=number]::-webkit-inner-spin-button{opacity:.2}
        input[type=date]::-webkit-calendar-picker-indicator{opacity:.4;cursor:pointer}
        select option{background:#111;color:#f0f0f0}
        .calcbtn,.dlbtn{border:none;width:100%;padding:15px;border-radius:14px;font-family:inherit;font-size:14px;font-weight:700;letter-spacing:1.2px;cursor:pointer;transition:all .25s}
        .calcbtn:hover,.dlbtn:hover{transform:translateY(-2px);filter:brightness(1.08)}
        .calcbtn:active,.dlbtn:active{transform:translateY(0)}
        .modebtn{flex:1;padding:15px 10px;border:none;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;border-radius:13px;margin:3px;transition:all .25s;letter-spacing:.3px}
        .tog-wrap{display:flex;align-items:center;gap:12px;cursor:pointer;user-select:none}
        .tog-track{width:44px;height:26px;border-radius:13px;position:relative;transition:background .25s;flex-shrink:0}
        .tog-dot{position:absolute;top:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left .25s;box-shadow:0 1px 5px rgba(0,0,0,.4)}
        .result-card,.sched-card{animation:fadeUp .3s cubic-bezier(.16,1,.3,1)}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        .sched-row:hover td{background:rgba(232,176,0,.06)!important}
        .sched-row td{transition:background .15s}
        .chip{display:inline-block;font-size:10px;font-weight:600;letter-spacing:.5px;padding:2px 8px;border-radius:20px}
      `}</style>

      <div style={{ maxWidth: 560, margin: "0 auto", padding: "32px 16px 64px" }}>

        {/* ── TOP BAR ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "3px", color: T.textSec, marginBottom: 5 }}>RENTAL BUSINESS TOOLS</div>
            <h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: "1.9rem", fontWeight: 800, lineHeight: 1, color: T.text }}>
              Lease<span style={{ color: T.accent }}>Pricer</span>
            </h1>
          </div>
          <button onClick={() => setDark(v => !v)} style={{
            background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 50,
            width: 46, height: 46, cursor: "pointer", fontSize: 20,
            display: "flex", alignItems: "center", justifyContent: "center", transition: "all .25s",
          }}>{dark ? "☀️" : "🌙"}</button>
        </div>

        {/* ── MODE ── */}
        <div style={{ ...cardStyle, padding: 6 }}>
          <div style={{ display: "flex" }}>
            {[
              { id: "rental", icon: "₹", label: "Find Rental", sub: "Target IRR → rental rate" },
              { id: "irr",    icon: "%", label: "Find IRR",    sub: "Known rental → IRR" },
            ].map(m => (
              <button key={m.id} className="modebtn" onClick={() => { setMode(m.id); setResult(null); setError(""); setShowSchedule(false); }}
                style={{ background: mode === m.id ? T.accent : "transparent", color: mode === m.id ? "#111" : T.textSec, boxShadow: mode === m.id ? `0 2px 16px rgba(232,176,0,.25)` : "none" }}>
                <div style={{ fontSize: 22, marginBottom: 3 }}>{m.icon}</div>
                <div>{m.label}</div>
                <div style={{ fontSize: 10, fontWeight: 400, opacity: .65, marginTop: 2 }}>{m.sub}</div>
              </button>
            ))}
          </div>
        </div>

        {/* ── ASSET DETAILS ── */}
        <div style={cardStyle}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.5px", color: T.textSec, marginBottom: 16 }}>ASSET DETAILS</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: T.textSec, marginBottom: 6 }}>Cost (₹)</div>
              <StyledInput dark={dark} accentColor={T.accent} type="number" placeholder="e.g. 150000" value={cost} onChange={e => setCost(e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: T.textSec, marginBottom: 6 }}>Duration (months)</div>
              <StyledInput dark={dark} accentColor={T.accent} type="number" placeholder="e.g. 36" value={duration} onChange={e => setDuration(e.target.value)} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: T.textSec, marginBottom: 6 }}>Payment Terms</div>
            <StyledSelect dark={dark} value={term} onChange={e => setTerm(e.target.value)}>
              {TERMS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </StyledSelect>
          </div>
        </div>

        {/* ── IRR / RENTAL ── */}
        <div style={cardStyle}>
          {mode === "rental" ? (
            <>
              <div style={{ fontSize: 11, color: T.textSec, marginBottom: 6 }}>Target IRR (% per annum)</div>
              <StyledInput dark={dark} accentColor={T.accent} type="number" placeholder="e.g. 24" value={irr} onChange={e => setIrr(e.target.value)} />
              {irr && <div style={{ fontSize: 11, color: T.accent, marginTop: 6, fontWeight: 500 }}>{irr}% p.a. target return</div>}
            </>
          ) : (
            <>
              <div style={{ fontSize: 11, color: T.textSec, marginBottom: 6 }}>{useStep ? `Regular Rental — ${pLabel} 2+ (₹)` : `Rental per ${pLabel} (₹)`}</div>
              <StyledInput dark={dark} accentColor={T.accent} type="number" placeholder="e.g. 5000" value={rental} onChange={e => setRental(e.target.value)} />
            </>
          )}
        </div>

        {/* ── RESIDUAL ── */}
        <div style={cardStyle}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.5px", color: T.textSec, marginBottom: 14 }}>RESIDUAL VALUE <span style={{ fontSize: 9, fontWeight: 400, opacity: .5 }}>(internal only — not shown in PDF)</span></div>
          <div style={segStyle}>
            <Pill active={resMode === "pct"} onClick={() => setResMode("pct")} colors={pillColors}>% of Cost</Pill>
            <Pill active={resMode === "value"} onClick={() => setResMode("value")} colors={pillColors}>Fixed ₹</Pill>
          </div>
          <div style={{ marginTop: 12 }}>
            <StyledInput dark={dark} accentColor={T.accent} type="number"
              placeholder={resMode === "pct" ? "e.g. 10 → 10% of cost" : "e.g. 15000"}
              value={resMode === "pct" ? resPct : resVal}
              onChange={e => resMode === "pct" ? setResPct(e.target.value) : setResVal(e.target.value)} />
          </div>
          {cv > 0 && ((resMode === "pct" && resPct) || (resMode === "value" && resVal)) && (
            <div style={{ fontSize: 11, color: T.accent, marginTop: 7, fontWeight: 500 }}>
              {resMode === "pct" ? `= ${fmt(parseFloat(resPct) / 100 * cv)}` : `= ${(parseFloat(resVal) / cv * 100).toFixed(2)}% of cost`}
            </div>
          )}
        </div>

        {/* ── DEPOSIT ── */}
        <div style={{ ...cardStyle, borderColor: `${T.green}44`, background: dark ? "rgba(46,194,126,.04)" : "rgba(46,194,126,.03)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.5px", color: T.green }}>SECURITY DEPOSIT</div>
            <span className="chip" style={{ background: T.greenSoft, color: T.green }}>REFUNDED AT END · OPTIONAL</span>
          </div>
          <div style={{ ...segStyle, borderColor: `${T.green}33` }}>
            <Pill active={depMode === "pct"} onClick={() => setDepMode("pct")} colors={{ activeBg: T.green, activeText: "#fff", inactiveText: T.textSec, shadow: "0 2px 10px rgba(46,194,126,.3)" }}>% of Cost</Pill>
            <Pill active={depMode === "value"} onClick={() => setDepMode("value")} colors={{ activeBg: T.green, activeText: "#fff", inactiveText: T.textSec, shadow: "0 2px 10px rgba(46,194,126,.3)" }}>Fixed ₹</Pill>
          </div>
          <div style={{ marginTop: 12 }}>
            <StyledInput dark={dark} accentColor={T.green} type="number"
              placeholder={depMode === "pct" ? "e.g. 10 → 10% of cost" : "e.g. 15000"}
              value={depMode === "pct" ? depPct : depVal}
              onChange={e => depMode === "pct" ? setDepPct(e.target.value) : setDepVal(e.target.value)}
              style={{ borderColor: `${T.green}44` }} />
          </div>
          {cv > 0 && ((depMode === "pct" && depPct) || (depMode === "value" && depVal)) && (
            <div style={{ fontSize: 11, color: T.green, marginTop: 7, fontWeight: 500 }}>
              {depMode === "pct"
                ? `= ${fmt(parseFloat(depPct) / 100 * cv)}  ·  net outlay = ${fmt(cv - parseFloat(depPct) / 100 * cv)}`
                : `= ${(parseFloat(depVal) / cv * 100).toFixed(2)}% of cost  ·  net outlay = ${fmt(cv - parseFloat(depVal))}`}
            </div>
          )}
        </div>

        {/* ── STEPPED RENTAL ── */}
        <div style={{ ...cardStyle, borderColor: useStep ? `${T.blue}55` : T.border, background: useStep ? T.blueSoft : T.surface }}>
          <div className="tog-wrap" onClick={() => { setUseStep(v => !v); setResult(null); }}>
            <div className="tog-track" style={{ background: useStep ? T.blue : (dark ? "#2a2a2a" : "#ddd") }}>
              <div className="tog-dot" style={{ left: useStep ? "21px" : "3px" }} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: useStep ? T.blue : T.textSec }}>Stepped First {pLabel === "month" ? "Month" : "Quarter"} Rental</div>
              <div style={{ fontSize: 11, color: T.textSec, marginTop: 1 }}>Larger upfront, then uniform for remaining periods</div>
            </div>
          </div>
          {useStep && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 11, background: T.blueSoft, color: T.blue, borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontWeight: 500 }}>
                First {pLabel} collected {term.includes("advance") ? "at signing" : "at end of period 1"}. Periods 2+ use regular rental.
              </div>
              <div style={segStyle}>
                <Pill active={frMode === "pct"} onClick={() => setFrMode("pct")} colors={{ activeBg: T.blue, activeText: "#fff", inactiveText: T.textSec, shadow: "0 2px 10px rgba(91,141,239,.3)" }}>% of Cost</Pill>
                <Pill active={frMode === "value"} onClick={() => setFrMode("value")} colors={{ activeBg: T.blue, activeText: "#fff", inactiveText: T.textSec, shadow: "0 2px 10px rgba(91,141,239,.3)" }}>Fixed ₹</Pill>
              </div>
              <div style={{ marginTop: 12 }}>
                <StyledInput dark={dark} accentColor={T.blue} type="number"
                  placeholder={frMode === "pct" ? "e.g. 20 → 20% of cost" : "e.g. 30000"}
                  value={frMode === "pct" ? frPct : frVal}
                  onChange={e => frMode === "pct" ? setFrPct(e.target.value) : setFrVal(e.target.value)}
                  style={{ borderColor: `${T.blue}44` }} />
              </div>
            </div>
          )}
        </div>

        {/* ── SCHEDULE SETTINGS ── */}
        <div style={{ ...cardStyle, borderColor: `${T.accent}33`, background: dark ? "rgba(232,176,0,.04)" : "rgba(232,176,0,.03)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.5px", color: T.accent, marginBottom: 14 }}>PAYMENT SCHEDULE SETTINGS</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: T.textSec, marginBottom: 6 }}>Rent Start Date</div>
              <StyledInput dark={dark} accentColor={T.accent} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ borderColor: `${T.accent}44` }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: T.textSec, marginBottom: 6 }}>Client Name (for PDF)</div>
              <StyledInput dark={dark} accentColor={T.accent} type="text" placeholder="e.g. Acme Corp" value={clientName} onChange={e => setClientName(e.target.value)} style={{ borderColor: `${T.accent}44` }} />
            </div>
          </div>
        </div>

        {/* ── CALCULATE BUTTON ── */}
        <button className="calcbtn" onClick={calculate} style={{
          background: `linear-gradient(135deg, ${T.accent}, #c89000)`,
          color: "#111", marginBottom: 14,
          boxShadow: `0 6px 24px rgba(232,176,0,.3)`,
        }}>CALCULATE & GENERATE SCHEDULE</button>

        {error && (
          <div style={{ background: "rgba(255,59,48,.1)", border: "1px solid rgba(255,59,48,.25)", borderRadius: 12, padding: "13px 16px", color: "#ff453a", fontSize: 13, marginBottom: 14, fontWeight: 500 }}>
            ⚠️ {error}
          </div>
        )}

        {/* ── RESULT SUMMARY ── */}
        {result && (
          <div className="result-card" style={{ background: T.surface, borderRadius: 20, overflow: "hidden", border: `1px solid ${T.accent}55`, boxShadow: `0 0 0 4px ${T.accent}10, 0 20px 60px rgba(0,0,0,.15)`, marginBottom: 14 }}>
            <div style={{ padding: "24px 24px 18px", background: `linear-gradient(135deg, ${T.accent}18, ${T.accent}06)`, borderBottom: `1px solid ${T.accent}33` }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "2.5px", color: T.accent, marginBottom: 8, opacity: .8 }}>
                {result.mode === "rental" ? "REQUIRED RENTAL PER PERIOD" : "ACHIEVED IRR"}
              </div>
              <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "3rem", fontWeight: 800, color: T.accent, lineHeight: 1 }}>
                {result.mode === "rental" ? fmtD(result.rental) : fmtPct(result.irr)}
              </div>
              {result.mode === "irr" && <div style={{ fontSize: 12, color: T.textSec, marginTop: 8 }}>{fmtPct(result.periodicRate)} per {result.ppy === 12 ? "month" : "quarter"}</div>}
            </div>
            <div style={{ padding: "4px 24px 20px" }}>
              <ResultLine label="Asset Cost" value={fmt(result.cost)} dark={dark} />
              {result.deposit > 0 && <ResultLine label="Security Deposit" value={`${fmt(result.deposit)} (${result.depositPct.toFixed(2)}%)`} accent dark={dark} />}
              {result.deposit > 0 && <ResultLine label="Net Outlay" value={fmt(result.cost - result.deposit)} accent dark={dark} />}
              {result.firstRental > 0 && <ResultLine label={`First ${pLabel.charAt(0).toUpperCase()+pLabel.slice(1)} Rental`} value={fmtD(result.firstRental)} dark={dark} />}
              <ResultLine label={`Regular Rental / ${pLabel}`} value={fmtD(result.rental)} dark={dark} />
              <ResultLine label="No. of Periods" value={`${result.totalPeriods} ${result.ppy === 12 ? "months" : "quarters"}`} dark={dark} />
              <ResultLine label="Total Rental Income" value={fmt(result.totalRental)} dark={dark} />
              <ResultLine label="Residual Value (internal)" value={`${fmtD(result.residual)} (${result.residualPct.toFixed(2)}%)`} dark={dark} />
              <ResultLine label="Total Recovery" value={fmt(result.totalRental + result.residual - result.deposit)} bold dark={dark} separator />
            </div>
          </div>
        )}

        {/* ── PAYMENT SCHEDULE TABLE ── */}
        {schedule.length > 0 && (
          <div className="sched-card" ref={scheduleRef} style={{ background: T.surface, borderRadius: 20, border: `1px solid ${T.border}`, overflow: "hidden", marginBottom: 14 }}>
            {/* Schedule header */}
            <div style={{ padding: "18px 22px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Payment Schedule</div>
                <div style={{ fontSize: 11, color: T.textSec, marginTop: 2 }}>
                  {schedule.length} payment{schedule.length > 1 ? "s" : ""} · Total payable: <strong style={{ color: T.text }}>{fmt(totalPayable)}</strong>
                </div>
              </div>
              <button onClick={() => setShowSchedule(v => !v)} style={{
                background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8,
                padding: "6px 14px", cursor: "pointer", fontFamily: "inherit",
                fontSize: 12, fontWeight: 600, color: T.textSec,
              }}>
                {showSchedule ? "Hide" : "Show"} Schedule
              </button>
            </div>

            {showSchedule && (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: dark ? "#1a1a1a" : "#f5f4f0" }}>
                      {["#", "Period", "Description", "Due Date", "Amount (₹)"].map(h => (
                        <th key={h} style={{ padding: "10px 14px", textAlign: h === "Amount (₹)" ? "right" : "left", fontSize: 10, fontWeight: 700, letterSpacing: "1px", color: T.textSec, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.map((row, i) => (
                      <tr key={i} className="sched-row" style={{ borderBottom: `1px solid ${T.border}` }}>
                        <td style={{ padding: "10px 14px", color: T.textSec, fontSize: 11 }}>{i + 1}</td>
                        <td style={{ padding: "10px 14px", color: T.textSec, fontSize: 11 }}>{row.period === "—" ? "—" : row.period}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ color: row.period === "—" ? T.green : T.text, fontWeight: row.period === "—" ? 600 : 400 }}>{row.type}</span>
                          {row.period === "—" && <span className="chip" style={{ background: T.greenSoft, color: T.green, marginLeft: 8 }}>REFUNDABLE</span>}
                        </td>
                        <td style={{ padding: "10px 14px", color: T.text, whiteSpace: "nowrap" }}>{row.dueDate}</td>
                        <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 600, color: T.text, whiteSpace: "nowrap" }}>{fmtD(row.amount)}</td>
                      </tr>
                    ))}
                    {/* Total row */}
                    <tr style={{ background: dark ? "rgba(232,176,0,.08)" : "rgba(232,176,0,.06)", borderTop: `2px solid ${T.accent}44` }}>
                      <td colSpan={3} />
                      <td style={{ padding: "12px 14px", fontSize: 11, fontWeight: 700, color: T.accent, letterSpacing: "1px" }}>TOTAL PAYABLE</td>
                      <td style={{ padding: "12px 14px", textAlign: "right", fontSize: 14, fontWeight: 800, color: T.accent }}>{fmt(totalPayable)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── DOWNLOAD PDF ── */}
        {schedule.length > 0 && (
          <button className="dlbtn" onClick={handleDownloadPDF} style={{
            background: dark ? "#1e1e1e" : "#fff",
            border: `2px solid ${T.accent}`,
            color: T.accent, marginBottom: 8,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          }}>
            {pdfLoading ? "⏳ Generating PDF..." : "⬇️  Download Payment Schedule PDF"}
          </button>
        )}

        {schedule.length > 0 && (
          <div style={{ fontSize: 11, color: T.textSec, textAlign: "center" }}>
            Residual value is excluded from the PDF · For internal use only
          </div>
        )}

      </div>
    </div>
  );
}
