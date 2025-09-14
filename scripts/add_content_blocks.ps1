$ErrorActionPreference='Stop'

function Insert-Section {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$MarkerRegex,
    [Parameter(Mandatory=$true)][string]$Html
  )
  if(!(Test-Path $Path)){ return }
  $txt = Get-Content -Raw -LiteralPath $Path
  if($txt -match $MarkerRegex){ return }
  $out = $txt -replace '</main>','  ' + $Html + "`n</main>"
  if($out -ne $txt){ [IO.File]::WriteAllText($Path,$out,[Text.Encoding]::UTF8) }
}

# Income Tax content
$itPath = 'income-tax-tool/index.html'
$itHtml = @"
<section class="card" style="margin-top:16px">
  <h2>How this Income Tax calculator works</h2>
  <p>This calculator estimates your India income tax for FY 2024–25 (AY 2025–26) under both the New and Old regimes. Enter your annual gross income, choose whether to include the standard deduction (₹50,000 for salaried/pensioners), and optionally toggle surcharge for high incomes. For the Old regime you may enter deductions such as Section 80C (up to ₹1,50,000), Section 80D (eligible health insurance premiums), additional NPS under Section 80CCD(1B) (up to ₹50,000), HRA details to compute the exempt portion, and home‑loan interest (self‑occupied: up to ₹2,00,000 set‑off). The tool compares total tax in New vs Old and shows monthly TDS and effective tax rate.</p>
  <p><b>New regime slabs:</b> 0–₹3L: 0%; ₹3–6L: 5%; ₹6–9L: 10%; ₹9–12L: 15%; ₹12–15L: 20%; >₹15L: 30%. <b>Old regime slabs:</b> 0–₹2.5L: 0%; ₹2.5–5L: 5%; ₹5–10L: 20%; >₹10L: 30%. Health & Education Cess of 4% applies on tax plus surcharge. Section 87A rebate makes tax ₹0 when total income is up to ₹7,00,000 (New) or up to ₹5,00,000 (Old). Surcharge, if enabled, applies above ₹50L, ₹1cr, ₹2cr and ₹5cr (with a 25% cap in the New regime).</p>
  <h3>Examples</h3>
  <p><b>Example 1:</b> Income ₹7,20,000, salaried, standard deduction on, no other deductions. New regime taxable = ₹6,70,000 → 87A rebate not available (above ₹7L threshold), tax per slabs + 4% cess. Old regime taxable = ₹6,70,000 after standard deduction; basic tax computed per old slabs; compare totals to choose the lower.</p>
  <p><b>Example 2:</b> Income ₹12,00,000 with Old‑regime deductions: 80C ₹1,50,000, 80D ₹25,000, NPS 80CCD(1B) ₹50,000, HRA exemption ₹1,20,000, home‑loan interest ₹2,00,000. Old regime taxable income reduces substantially; New regime disallows most of these (only standard deduction), so Old may be lower. Use “Compare New vs Old” to see which wins.</p>
  <h3>FAQs</h3>
  <details><summary><b>Which regime should I choose?</b></summary><p>If your total eligible deductions (80C, 80D, NPS 1B, HRA, home‑loan interest) are high, the Old regime often results in lower tax. If deductions are minimal, the New regime’s lower rate structure and standard deduction can be better. This tool compares both.</p></details>
  <details><summary><b>Is HRA allowed in the New regime?</b></summary><p>No. Most deductions, including HRA, are not allowed in the New regime (only the standard deduction for salaried/pensioners is applied when selected). HRA exemption (Old only) is the least of: actual HRA received; rent paid − 10% of basic; 50% of basic for metro (40% non‑metro).</p></details>
  <details><summary><b>Are results exact?</b></summary><p>They are indicative for planning. Personal nuances (perquisites, set‑offs, multiple incomes, rounding, TDS/TCS timing) may alter outcomes. Consult a tax professional for your filing.</p></details>
</section>
"@
Insert-Section -Path $itPath -MarkerRegex 'How this Income Tax calculator works' -Html $itHtml

# GST content
$gstPath = 'gst-calculator/index.html'
$gstHtml = @"
<section class="card" style="margin-top:16px">
  <h2>How this GST calculator works</h2>
  <p>Enter an amount and choose a GST rate (5%, 12%, 18%, 28% or custom). Select whether the amount is GST‑inclusive or exclusive, and whether the supply is intra‑state (CGST+SGST) or inter‑state (IGST). For GST‑inclusive, the base is back‑calculated as amount ÷ (1 + rate), and GST is the difference between total and base. For GST‑exclusive, GST is base × rate and total = base + GST. When intra‑state is chosen, GST splits equally into CGST and SGST; for inter‑state, IGST applies.</p>
  <h3>Examples</h3>
  <p><b>Inclusive 18%:</b> Amount ₹1,180 inclusive → base = 1180/1.18 = ₹1,000; GST = ₹180 (CGST ₹90 + SGST ₹90, or IGST ₹180).</p>
  <p><b>Exclusive 12%:</b> Base ₹2,000 exclusive → GST = 2000 × 12% = ₹240; total = ₹2,240.</p>
  <p>You can round to the nearest rupee for invoices or keep paise for precise calculations. Share a link or export CSV for records.</p>
  <h3>FAQs</h3>
  <details><summary><b>CGST/SGST vs IGST?</b></summary><p>Intra‑state supplies split GST into equal CGST and SGST components. Inter‑state supplies levy IGST. This is a display split and doesn’t change the total.</p></details>
  <details><summary><b>Which rates are common?</b></summary><p>Many essentials are 0% or 5%; services and goods often fall under 12% or 18%; luxury items may be 28%. Always verify the applicable rate for your item/service.</p></details>
  <details><summary><b>Is this a filing tool?</b></summary><p>No. It’s a quick calculator to estimate base/GST/total for quotes and invoices; it does not file returns.</p></details>
</section>
"@
Insert-Section -Path $gstPath -MarkerRegex 'How this GST calculator works' -Html $gstHtml

# EMI add-on content
$emiPath = 'emi-calculator/index.html'
$emiAdd = @"
<section class="card" style="margin-top:16px">
  <h2>Examples & FAQs</h2>
  <p><b>Example:</b> ₹7,50,000 at 10% p.a. for 60 months → r = 0.10/12; EMI ≈ ₹15,937; total interest ≈ ₹2,56,220; total ≈ ₹10,06,220. A prepayment of ₹1,00,000 in month 12 reduces principal and shortens the schedule.</p>
  <details><summary><b>Which is better: shorter or longer tenure?</b></summary><p>Shorter tenure lowers total interest but raises EMI. Choose an EMI with headroom for emergencies and rate changes.</p></details>
  <details><summary><b>Can I compare two loans?</b></summary><p>Yes. Fill the “Compare” fields to estimate EMI and total interest for a second loan side‑by‑side.</p></details>
</section>
"@
Insert-Section -Path $emiPath -MarkerRegex 'Examples & FAQs' -Html $emiAdd

# SIP add-on content
$sipPath = 'sip-calculator/index.html'
$sipAdd = @"
<section class="card" style="margin-top:16px">
  <h2>Examples & FAQs</h2>
  <p><b>Example:</b> ₹5,000/month for 15 years at 12% p.a. → monthly r = 0.12/12. FV ≈ ₹27.9 lakh. With a 10% annual step‑up in contribution, FV can be substantially higher. Use inflation to view values in today’s rupees.</p>
  <details><summary><b>Are returns guaranteed?</b></summary><p>No. Markets fluctuate. Historical CAGR is informative, not predictive. Choose assumptions conservatively.</p></details>
  <details><summary><b>How does step‑up work?</b></summary><p>Each year, your monthly contribution increases by the step‑up %, raising total invested and FV.</p></details>
</section>
"@
Insert-Section -Path $sipPath -MarkerRegex 'Examples & FAQs' -Html $sipAdd

# FD content
$fdPath = 'fd-calculator/index.html'
$fdHtml = @"
<section class="card" style="margin-top:16px">
  <h2>How this FD calculator works</h2>
  <p>Enter principal (deposit), annual interest rate, and tenure (years/months/days). Choose payout type: cumulative (reinvestment) compounds the interest until maturity; non‑cumulative pays monthly/quarterly/half‑yearly/yearly interest to your account and may compute APY based on payout. Senior‑citizen option can add a rate premium where applicable. The tool outputs maturity amount, total interest, effective annual yield (APY), and optionally estimates TDS impact.</p>
  <h3>Examples</h3>
  <p><b>Cumulative:</b> ₹2,00,000 at 7.25% p.a. for 2 years → maturity ≈ ₹2,31,000 (compounded quarterly; exact value depends on bank’s compounding/payout convention).</p>
  <p><b>Monthly payout:</b> ₹5,00,000 at 7% p.a. monthly → interest ≈ ₹2,917/month before tax; principal remains ₹5,00,000; APY differs from nominal based on payout frequency.</p>
  <h3>FAQs</h3>
  <details><summary><b>What is APY?</b></summary><p>Annual Percentage Yield reflects compounding effects and lets you compare deposits with different payout frequencies. APY ≥ nominal rate when reinvested, equal to or lower when interest is withdrawn.</p></details>
  <details><summary><b>How is TDS handled?</b></summary><p>Banks may deduct TDS when interest exceeds thresholds. This calculator provides an indicative estimate; verify with your bank and tax rules.</p></details>
  <details><summary><b>Is premature withdrawal supported?</b></summary><p>This tool doesn’t model penalties for early closure. Check your bank’s policy for breakage and revised interest.</p></details>
</section>
"@
Insert-Section -Path $fdPath -MarkerRegex 'How this FD calculator works' -Html $fdHtml

# Currency add-on content
$ccPath = 'currency-converter/index.html'
$ccAdd = @"
<section class="card" style="margin-top:16px">
  <h2>Examples & FAQs</h2>
  <p><b>Example:</b> 100 USD → INR at 83.20 mid‑market with 2% fee → adjusted rate ≈ 81.54; result ≈ ₹8,154. Use the 30‑day mini chart to sanity‑check volatility.</p>
  <details><summary><b>Why do my card/bank rates differ?</b></summary><p>Institutions add spreads and fees; weekends/holidays and market moves also affect timing. Add a fee % here to approximate your effective rate.</p></details>
  <details><summary><b>Can I share or bookmark?</b></summary><p>Yes. Use Share to copy a URL with parameters; opening it restores your settings.</p></details>
</section>
"@
Insert-Section -Path $ccPath -MarkerRegex 'Examples & FAQs' -Html $ccAdd

