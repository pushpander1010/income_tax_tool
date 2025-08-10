import { computeTaxCore, applyRebate87A, withCess } from "./tax";
import { CONFIG } from "./slabs";

const incomeEl = document.getElementById("income") as HTMLInputElement;
const deductionsEl = document.getElementById("deductions") as HTMLInputElement | null;
const stdDeductionEl = document.getElementById("stdDeduction") as HTMLInputElement | null;
const regimeEl = document.getElementById("regime") as HTMLSelectElement;
const resultEl = document.getElementById("result") as HTMLDivElement;
const btn = document.getElementById("calcBtn") as HTMLButtonElement;

const fmtINR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function getTaxableIncome(rawIncome: number): number {
  const ded = Number(deductionsEl?.value || 0);
  const std = stdDeductionEl?.checked ? 50000 : 0;
  return Math.max(0, rawIncome - ded - std);
}

function calculate() {
  const rawIncome = Number(incomeEl.value || 0);
  const taxableIncome = getTaxableIncome(rawIncome);
  const regime = (regimeEl.value === "old" ? "old" : "new") as "new" | "old";
  const { slabs, rebateThreshold } = CONFIG[regime];
  const cessRate = CONFIG.cessRate;

  const basic = computeTaxCore(taxableIncome, slabs);
  const afterRebate = applyRebate87A(taxableIncome, basic, rebateThreshold);
  const { cess, total } = withCess(afterRebate, cessRate);
  const monthly = Math.round(total / 12);

  const newReg = CONFIG["new"];
  const oldReg = CONFIG["old"];
  const compareNew = withCess(
    applyRebate87A(taxableIncome, computeTaxCore(taxableIncome, newReg.slabs), newReg.rebateThreshold),
    cessRate
  ).total;
  const compareOld = withCess(
    applyRebate87A(taxableIncome, computeTaxCore(taxableIncome, oldReg.slabs), oldReg.rebateThreshold),
    cessRate
  ).total;
  const better = compareNew === compareOld ? "Same" : (compareNew < compareOld ? "New" : "Old");

  // Persist in URL
  const params = new URLSearchParams({
    income: String(rawIncome || 0),
    deductions: String(Number(deductionsEl?.value || 0)),
    std: String(stdDeductionEl?.checked ? 1 : 0),
    regime,
  });
  history.replaceState(null, "", `?${params.toString()}`);

  // UI
  resultEl.innerHTML = `
    <div class="row"><span>Taxable Income</span><span class="amount">${fmtINR.format(taxableIncome)}</span></div>
    <div class="row"><span>Basic Tax</span><span class="amount">${fmtINR.format(afterRebate)}</span></div>
    <div class="row"><span>Health & Education Cess (4%)</span><span class="amount">${fmtINR.format(cess)}</span></div>
    <hr style="opacity:.2" />
    <div class="row" style="font-weight:700"><span>Total Tax Payable</span><span class="amount">${fmtINR.format(total)}</span></div>
    <div class="row"><span>Approx. Monthly (TDS)</span><span class="amount">${fmtINR.format(monthly)}</span></div>
    <div class="row"><span>Cheaper Regime</span><span class="amount">${better}</span></div>
    ${afterRebate === 0 ? `<p class="note">No tax payable due to Section 87A rebate.</p>` : ""}
  `;
}

function hydrateFromUrl() {
  const params = new URLSearchParams(location.search);
  const income = Number(params.get("income") || 0);
  const deductions = Number(params.get("deductions") || 0);
  const std = params.get("std") === "1";
  const regime = params.get("regime");
  if (income) incomeEl.value = String(income);
  if (deductionsEl) deductionsEl.value = String(deductions || "");
  if (stdDeductionEl) stdDeductionEl.checked = std;
  if (regime === "new" || regime === "old") regimeEl.value = regime;
}

btn.addEventListener("click", calculate);
incomeEl.addEventListener("keydown", (e) => { if (e.key === "Enter") calculate(); });
deductionsEl?.addEventListener("keydown", (e) => { if (e.key === "Enter") calculate(); });
stdDeductionEl?.addEventListener("change", calculate);
regimeEl.addEventListener("change", calculate);

hydrateFromUrl();
// auto-calc on load if values present
if (incomeEl.value) calculate();
