import { useState, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// IRR SOLVER  (Newton-Raphson)
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
function annualIRR(periodicRate, ppy) {
  return (Math.pow(1 + periodicRate, ppy) - 1) * 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// CASHFLOW BUILDER
// Handles:
//   • advance / arrears
//   • optional security deposit (received t=0, refunded at end)
//   • optional stepped rental: firstRental for period 1, rental for rest
//     In advance mode  → firstRental collected at t=0, then normal rentals from t=1
//     In arrears mode  → firstRental collected at t=1, then normal rentals from t=2
// ─────────────────────────────────────────────────────────────────────────────
function buildCashflows({ cost, rental, duration, paymentTerm, residual, deposit, firstRental }) {
  const isQtr     = paymentTerm.includes("quarterly");
  const isAdvance = paymentTerm.includes("advance");
  const totalPeriods = isQtr ? Math.ceil(duration / 3) : duration;
  const ppy          = isQtr ? 4 : 12;
  const dep          = deposit     || 0;
  const fr           = (firstRental != null && firstRental > 0) ? firstRental : null; // null = no step
  const cfs          = new Array(totalPeriods + 1).fill(0);

  cfs[0] = -cost + dep;

  if (isAdvance) {
    // t=0: collect first period rent (stepped or normal)
    cfs[0] += fr !== null ? fr : rental;
    // t=1 … totalPeriods-1: normal rental
    for (let i = 1; i < totalPeriods; i++) cfs[i] += rental;
  } else {
    // t=1: first period (stepped or normal)
    cfs[1] += fr !== null ? fr : rental;
    // t=2 … totalPeriods: normal rental
    for (let i = 2; i <= totalPeriods; i++) cfs[i] += rental;
  }

  cfs[totalPeriods] += residual - dep;
  return { cfs, ppy, totalPeriods };
}

// ─────────────────────────────────────────────────────────────────────────────
// SOLVERS
// ─────────────────────────────────────────────────────────────────────────────
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

function solveResidual({ cost, rental, targetIRR, duration, paymentTerm, deposit, firstRental }) {
  const ppy = paymentTerm.includes("quarterly") ? 4 : 12;
  let lo = 0, hi = cost * 5, mid = 0;
  for (let i = 0; i < 300; i++) {
    mid = (lo + hi) / 2;
    const { cfs } = buildCashflows({ cost, rental, duration, paymentTerm, residual: mid, deposit, firstRental });
    const ann = annualIRR(solveIRR(cfs), ppy);
    if (Math.abs(ann - targetIRR) < 0.00005) break;
    if (ann < targetIRR) lo = mid; else hi = mid;
  }
  return mid;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const fmt    = n => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
const fmtD   = n => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
const fmtPct = n => n.toFixed(4) + "%";

const MODES = [
  { id: "irr",      label: "Find IRR",      desc: "Enter rental & residual → get IRR" },
  { id: "rental",   label: "Find Rental",   desc: "Enter target IRR & residual → get rental" },
  { id: "residual", label: "Find Residual", desc: "Enter rental & target IRR → get residual" },
];
const TERMS = [
  { value: "monthly_advance",   label: "Monthly — Advance" },
  { value: "monthly_arrears",   label: "Monthly — Arrears" },
  { value: "quarterly_advance", label: "Quarterly — Advance" },
  { value: "quarterly_arrears", label: "Quarterly — Arrears" },
];

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function RentalPricer() {
  const [mode,          setMode]          = useState("irr");
  const [cost,          setCost]          = useState("");
  const [duration,      setDuration]      = useState("");
  const [term,          setTerm]          = useState("monthly_advance");
  const [rental,        setRental]        = useState("");
  const [targetIRR,     setTargetIRR]     = useState("");
  const [residualMode,  setResidualMode]  = useState("pct");
  const [residualPct,   setResidualPct]   = useState("");
  const [residualVal,   setResidualVal]   = useState("");
  const [deposit,       setDeposit]       = useState("");
  // Stepped rental state
  const [useStep,       setUseStep]       = useState(false);
  const [firstRentMode, setFirstRentMode] = useState("pct"); // "pct" | "value"
  const [firstRentPct,  setFirstRentPct]  = useState("");
  const [firstRentVal,  setFirstRentVal]  = useState("");

  const [result, setResult] = useState(null);
  const [error,  setError]  = useState("");

  const getResidual = () => {
    const c = parseFloat(cost) || 0;
    if (residualMode === "pct") return (parseFloat(residualPct) / 100) * c || 0;
    return parseFloat(residualVal) || 0;
  };

  const getFirstRental = (c) => {
    if (!useStep) return null;
    if (firstRentMode === "pct") return (parseFloat(firstRentPct) / 100) * c || 0;
    return parseFloat(firstRentVal) || 0;
  };

  const totalRentalIncome = (r, fr, totalPeriods, isAdvance) => {
    // periods with normal rental
    const normalPeriods = fr != null ? totalPeriods - 1 : totalPeriods;
    return (fr != null ? fr : 0) + r * normalPeriods;
  };

  const calculate = useCallback(() => {
    setError(""); setResult(null);
    const c   = parseFloat(cost);
    const d   = parseInt(duration);
    const dep = parseFloat(deposit) || 0;
    if (!c || !d) return setError("Enter asset cost and duration.");

    try {
      const ppy = term.includes("quarterly") ? 4 : 12;
      const fr  = getFirstRental(c);

      if (mode === "irr") {
        const r = parseFloat(rental);
        if (!r) return setError("Enter rental per period.");
        const residual = getResidual();
        const { cfs, totalPeriods } = buildCashflows({ cost: c, rental: r, duration: d, paymentTerm: term, residual, deposit: dep, firstRental: fr });
        const periodicRate = solveIRR(cfs);
        const ann = annualIRR(periodicRate, ppy);
        if (isNaN(ann) || !isFinite(ann)) return setError("Could not converge. Check inputs.");
        const tot = totalRentalIncome(r, fr, totalPeriods);
        setResult({ type: "irr", irr: ann, periodicRate: periodicRate * 100, ppy, rental: r, firstRental: fr, residual, deposit: dep, residualPct: (residual / c) * 100, totalPeriods, totalRental: tot, cost: c });

      } else if (mode === "rental") {
        const irr = parseFloat(targetIRR);
        if (!irr) return setError("Enter target IRR.");
        const residual = getResidual();
        const r = solveRental({ cost: c, targetIRR: irr, duration: d, paymentTerm: term, residual, deposit: dep, firstRental: fr });
        const { totalPeriods } = buildCashflows({ cost: c, rental: r, duration: d, paymentTerm: term, residual, deposit: dep, firstRental: fr });
        const tot = totalRentalIncome(r, fr, totalPeriods);
        setResult({ type: "rental", rental: r, irr, firstRental: fr, residual, deposit: dep, residualPct: (residual / c) * 100, totalPeriods, totalRental: tot, cost: c, ppy });

      } else {
        const irr = parseFloat(targetIRR);
        const r   = parseFloat(rental);
        if (!irr || !r) return setError("Enter target IRR and rental.");
        const residual = solveResidual({ cost: c, rental: r, targetIRR: irr, duration: d, paymentTerm: term, deposit: dep, firstRental: fr });
        const { totalPeriods } = buildCashflows({ cost: c, rental: r, duration: d, paymentTerm: term, residual, deposit: dep, firstRental: fr });
        const tot = totalRentalIncome(r, fr, totalPeriods);
        setResult({ type: "residual", residual, residualPct: (residual / c) * 100, irr, rental: r, firstRental: fr, deposit: dep, totalPeriods, totalRental: tot, cost: c, ppy });
      }
    } catch (e) {
      setError("Calculation error. Please check your inputs.");
    }
  }, [mode, cost, duration, term, rental, targetIRR, residualMode, residualPct, residualVal, deposit, useStep, firstRentMode, firstRentPct, firstRentVal]);

  const iCls = "w-full bg-stone-900 border border-stone-700 rounded-lg px-4 py-2.5 text-stone-100 text-sm focus:outline-none focus:border-amber-500 transition-colors placeholder-stone-600";
  const lCls = "block text-xs font-semibold tracking-widest text-stone-500 uppercase mb-1.5";
  const periodLabel = term.includes("quarterly") ? "quarter" : "month";

  return (
    <div style={{ fontFamily: "'DM Mono','Courier New',monospace", minHeight: "100vh", background: "#0f0e0d", color: "#e8e0d0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Playfair+Display:wght@700&display=swap');
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#1a1917}::-webkit-scrollbar-thumb{background:#78716c;border-radius:2px}
        .mb{background:transparent;border:1px solid #44403c;border-radius:8px;padding:10px 14px;cursor:pointer;transition:all .2s;text-align:left}
        .mb:hover{border-color:#d97706}.mb.on{border-color:#d97706;background:rgba(217,119,6,.1)}
        .cb{background:linear-gradient(135deg,#d97706,#b45309);border:none;border-radius:10px;padding:14px;width:100%;cursor:pointer;color:#0f0e0d;font-weight:700;font-size:15px;letter-spacing:2px;font-family:inherit;transition:all .2s}
        .cb:hover{transform:translateY(-1px);box-shadow:0 8px 24px rgba(217,119,6,.3)}.cb:active{transform:translateY(0)}
        .rc{background:linear-gradient(135deg,rgba(217,119,6,.08),rgba(180,83,9,.04));border:1px solid rgba(217,119,6,.3);border-radius:14px;padding:24px}
        .rr{display:flex;justify-content:space-between;align-items:baseline;padding:8px 0;border-bottom:1px solid rgba(120,113,108,.2)}
        .rr:last-child{border-bottom:none}
        .rh{font-size:2.5rem;font-family:'Playfair Display',serif;color:#d97706;line-height:1}
        .sb{flex:1;padding:8px;border:1px solid #44403c;background:transparent;color:#a8a29e;cursor:pointer;font-family:inherit;font-size:12px;transition:all .2s}
        .sb:first-child{border-radius:8px 0 0 8px}.sb:last-child{border-radius:0 8px 8px 0}.sb.on{background:#44403c;color:#e8e0d0}
        .toggle{display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none}
        .tog-track{width:40px;height:22px;border-radius:11px;transition:background .2s;flex-shrink:0;position:relative}
        .tog-thumb{position:absolute;top:3px;width:16px;height:16px;border-radius:50%;background:#e8e0d0;transition:left .2s}
        input[type=number]::-webkit-inner-spin-button{opacity:.3}
        select option{background:#1c1917}
        .step-box{background:rgba(139,92,246,.05);border:1px solid rgba(139,92,246,.2);border-radius:10px;padding:14px 16px;margin-bottom:16px}
        .step-box-open{border-color:rgba(139,92,246,.4);background:rgba(139,92,246,.08)}
      `}</style>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px" }}>

        {/* Header */}
        <div style={{ marginBottom: 32, borderBottom: "1px solid #292524", paddingBottom: 24 }}>
          <div style={{ fontSize: 11, letterSpacing: 4, color: "#78716c", marginBottom: 8 }}>RENTAL BUSINESS TOOLS</div>
          <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: "2.2rem", margin: 0, color: "#e8e0d0", lineHeight: 1.1 }}>Lease Pricer</h1>
          <p style={{ fontSize: 13, color: "#78716c", margin: "8px 0 0" }}>IRR · Rental · Residual · Deposit · Stepped Rental</p>
        </div>

        {/* Mode */}
        <div style={{ marginBottom: 28 }}>
          <div className={lCls}>Solve For</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {MODES.map(m => (
              <button key={m.id} className={`mb ${mode === m.id ? "on" : ""}`}
                onClick={() => { setMode(m.id); setResult(null); setError(""); }}>
                <div style={{ fontSize: 13, color: mode === m.id ? "#d97706" : "#e8e0d0", fontWeight: 500, marginBottom: 4 }}>{m.label}</div>
                <div style={{ fontSize: 11, color: "#78716c", lineHeight: 1.3 }}>{m.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Cost + Duration */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <div>
            <label className={lCls}>Asset Cost (₹)</label>
            <input className={iCls} type="number" placeholder="e.g. 150000" value={cost} onChange={e => setCost(e.target.value)} />
          </div>
          <div>
            <label className={lCls}>Duration (months)</label>
            <input className={iCls} type="number" placeholder="e.g. 36" value={duration} onChange={e => setDuration(e.target.value)} />
          </div>
        </div>

        {/* Payment term */}
        <div style={{ marginBottom: 16 }}>
          <label className={lCls}>Payment Terms</label>
          <select className={iCls} style={{ cursor: "pointer" }} value={term} onChange={e => setTerm(e.target.value)}>
            {TERMS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        {/* Rental / Target IRR */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          {(mode === "irr" || mode === "residual") && (
            <div>
              <label className={lCls}>
                {useStep ? `Rental from ${periodLabel} 2 onwards (₹)` : `Rental per Period (₹)`}
              </label>
              <input className={iCls} type="number" placeholder="e.g. 5000" value={rental} onChange={e => setRental(e.target.value)} />
            </div>
          )}
          {(mode === "rental" || mode === "residual") && (
            <div>
              <label className={lCls}>Target IRR (% p.a.)</label>
              <input className={iCls} type="number" placeholder="e.g. 18" value={targetIRR} onChange={e => setTargetIRR(e.target.value)} />
            </div>
          )}
        </div>

        {/* Residual */}
        {mode !== "residual" && (
          <div style={{ marginBottom: 16 }}>
            <label className={lCls}>Residual Value</label>
            <div style={{ display: "flex", marginBottom: 10 }}>
              <button className={`sb ${residualMode === "pct" ? "on" : ""}`} onClick={() => setResidualMode("pct")}>% of Cost</button>
              <button className={`sb ${residualMode === "value" ? "on" : ""}`} onClick={() => setResidualMode("value")}>Fixed ₹</button>
            </div>
            {residualMode === "pct"
              ? <input className={iCls} type="number" placeholder="e.g. 10 for 10%" value={residualPct} onChange={e => setResidualPct(e.target.value)} />
              : <input className={iCls} type="number" placeholder="e.g. 15000" value={residualVal} onChange={e => setResidualVal(e.target.value)} />
            }
            <div style={{ fontSize: 11, color: "#57534e", marginTop: 6 }}>
              {residualMode === "pct" && cost && residualPct ? `= ${fmt(parseFloat(residualPct) / 100 * parseFloat(cost))}` : ""}
              {residualMode === "value" && cost && residualVal ? `= ${(parseFloat(residualVal) / parseFloat(cost) * 100).toFixed(2)}% of cost` : ""}
            </div>
          </div>
        )}

        {/* ── STEPPED RENTAL ── */}
        <div className={`step-box ${useStep ? "step-box-open" : ""}`} style={{ marginBottom: 16 }}>
          {/* Toggle header */}
          <div className="toggle" onClick={() => { setUseStep(v => !v); setResult(null); }} style={{ marginBottom: useStep ? 14 : 0 }}>
            <div className="tog-track" style={{ background: useStep ? "#7c3aed" : "#44403c" }}>
              <div className="tog-thumb" style={{ left: useStep ? "21px" : "3px" }} />
            </div>
            <div>
              <div style={{ fontSize: 13, color: useStep ? "#c4b5fd" : "#a8a29e", fontWeight: 500 }}>Stepped First {periodLabel === "month" ? "Month" : "Quarter"} Rental</div>
              <div style={{ fontSize: 11, color: "#57534e", marginTop: 2 }}>Larger upfront rental, then uniform for remaining periods</div>
            </div>
          </div>

          {useStep && (
            <>
              <div style={{ fontSize: 11, color: "#7c3aed", background: "rgba(124,58,237,.1)", border: "1px solid rgba(124,58,237,.2)", borderRadius: 6, padding: "8px 12px", marginBottom: 12 }}>
                First {periodLabel} rental collected {term.includes("advance") ? "upfront at signing" : "at end of period 1"}. Periods 2 onwards use the regular rental above.
              </div>
              <div style={{ display: "flex", marginBottom: 10 }}>
                <button className={`sb ${firstRentMode === "pct" ? "on" : ""}`} onClick={() => setFirstRentMode("pct")}>% of Cost</button>
                <button className={`sb ${firstRentMode === "value" ? "on" : ""}`} onClick={() => setFirstRentMode("value")}>Fixed ₹</button>
              </div>
              {firstRentMode === "pct"
                ? <input className={iCls} style={{ borderColor: "#4c1d95" }} type="number" placeholder="e.g. 20 for 20% of cost" value={firstRentPct} onChange={e => setFirstRentPct(e.target.value)} />
                : <input className={iCls} style={{ borderColor: "#4c1d95" }} type="number" placeholder="e.g. 30000" value={firstRentVal} onChange={e => setFirstRentVal(e.target.value)} />
              }
              {/* Preview */}
              {cost && ((firstRentMode === "pct" && firstRentPct) || (firstRentMode === "value" && firstRentVal)) && (
                <div style={{ fontSize: 11, color: "#a78bfa", marginTop: 8, lineHeight: 1.7 }}>
                  {(() => {
                    const c  = parseFloat(cost) || 0;
                    const fr = firstRentMode === "pct" ? (parseFloat(firstRentPct) / 100) * c : parseFloat(firstRentVal) || 0;
                    const r  = parseFloat(rental) || 0;
                    return (
                      <>
                        <span>First {periodLabel}: <strong style={{ color: "#c4b5fd" }}>{fmtD(fr)}</strong></span>
                        {firstRentMode === "value" && c ? <span> = {(fr / c * 100).toFixed(2)}% of cost</span> : ""}
                        {firstRentMode === "pct"   && c ? <span> = {fmt(fr)}</span> : ""}
                        {r > 0 && <><br /><span>Remaining periods: <strong style={{ color: "#c4b5fd" }}>{fmtD(r)}</strong> / {periodLabel}</span></>}
                        {r > 0 && fr > 0 && <><br /><span>Uplift vs regular: <strong style={{ color: "#c4b5fd" }}>+{fmtD(fr - r)}</strong> ({((fr / r - 1) * 100).toFixed(1)}% higher)</span></>}
                      </>
                    );
                  })()}
                </div>
              )}
            </>
          )}
        </div>

        {/* Security deposit */}
        <div style={{ marginBottom: 24, background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.15)", borderRadius: 10, padding: "14px 16px" }}>
          <label className={lCls} style={{ color: "#6ee7b7" }}>
            Security Deposit (₹)
            <span style={{ fontSize: 10, color: "#4ade80", marginLeft: 8, letterSpacing: 1, fontWeight: 400, textTransform: "none" }}>optional — refunded at end</span>
          </label>
          <input className={iCls} style={{ borderColor: "#166534", background: "#0a1f0f" }} type="number"
            placeholder="e.g. 10000" value={deposit} onChange={e => setDeposit(e.target.value)} />
          {deposit && cost && parseFloat(deposit) > 0 && (
            <div style={{ fontSize: 11, color: "#4ade80", marginTop: 6 }}>
              {(parseFloat(deposit) / parseFloat(cost) * 100).toFixed(1)}% of cost · net outlay = {fmt(parseFloat(cost) - parseFloat(deposit))}
            </div>
          )}
        </div>

        <button className="cb" onClick={calculate}>CALCULATE</button>

        {error && (
          <div style={{ marginTop: 16, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "12px 16px", color: "#fca5a5", fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* ── RESULT ── */}
        {result && (
          <div className="rc" style={{ marginTop: 24 }}>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, letterSpacing: 3, color: "#78716c", marginBottom: 6 }}>
                {result.type === "irr" ? "ACHIEVED IRR" : result.type === "rental" ? `REGULAR RENTAL (${periodLabel}s 2+)` : "REQUIRED RESIDUAL"}
              </div>
              <div className="rh">
                {result.type === "irr"      && fmtPct(result.irr)}
                {result.type === "rental"   && fmtD(result.rental)}
                {result.type === "residual" && fmtD(result.residual)}
              </div>
              {result.type === "irr" && (
                <div style={{ fontSize: 12, color: "#78716c", marginTop: 4 }}>
                  {fmtPct(result.periodicRate)} per {result.ppy === 12 ? "month" : "quarter"}
                </div>
              )}
              {result.type === "residual" && (
                <div style={{ fontSize: 12, color: "#78716c", marginTop: 4 }}>
                  {result.residualPct.toFixed(2)}% of asset cost
                </div>
              )}
              {result.type === "rental" && result.firstRental != null && result.firstRental > 0 && (
                <div style={{ fontSize: 12, color: "#a78bfa", marginTop: 6 }}>
                  First {periodLabel}: {fmtD(result.firstRental)} · then {fmtD(result.rental)} / {periodLabel}
                </div>
              )}
            </div>

            <div>
              {[
                ["Asset Cost",            fmt(result.cost)],
                result.deposit > 0 &&
                  ["Security Deposit",    fmt(result.deposit)],
                result.deposit > 0 &&
                  ["Net Outlay",          fmt(result.cost - result.deposit)],
                result.firstRental != null && result.firstRental > 0 &&
                  [`First ${periodLabel.charAt(0).toUpperCase()+periodLabel.slice(1)} Rental`, `${fmtD(result.firstRental)} (${(result.firstRental / result.cost * 100).toFixed(2)}% of cost)`],
                result.type !== "rental" &&
                  [`Regular Rental (${periodLabel}s 2+)`, fmtD(result.rental)],
                result.type === "rental" && !(result.firstRental > 0) &&
                  ["Rental / Period",     fmtD(result.rental)],
                ["No. of Periods",        `${result.totalPeriods} ${result.ppy === 12 ? "months" : "quarters"}`],
                ["Total Rental Income",   fmt(result.totalRental)],
                ["Residual Value",        `${fmtD(result.residual)} (${result.residualPct.toFixed(2)}%)`],
                result.type !== "irr" &&
                  ["Target IRR",          fmtPct(result.irr)],
                result.deposit > 0 &&
                  ["Net Terminal Cash",   fmt(result.residual - result.deposit)],
                ["Total Recovery",        fmt(result.totalRental + result.residual - result.deposit)],
              ].filter(Boolean).map(([label, value]) => {
                const isGreen  = label === "Security Deposit" || label === "Net Outlay" || label === "Net Terminal Cash";
                const isPurple = label.startsWith("First ");
                return (
                  <div className="rr" key={label}>
                    <span style={{ fontSize: 12, color: isGreen ? "#86efac" : isPurple ? "#c4b5fd" : "#78716c", letterSpacing: 1 }}>{label}</span>
                    <span style={{ fontSize: 14, color: isGreen ? "#86efac" : isPurple ? "#c4b5fd" : "#e8e0d0", fontWeight: 500 }}>{value}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
