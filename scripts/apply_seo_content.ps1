$ErrorActionPreference='Stop'

function Replace-InFile([string]$path,[hashtable]$pairs){
  if(!(Test-Path $path)){ return }
  $txt = Get-Content -Raw -LiteralPath $path
  $orig = $txt
  foreach($k in $pairs.Keys){ $txt = [Regex]::Replace($txt, $k, $pairs[$k]) }
  if($txt -ne $orig){ [IO.File]::WriteAllText($path,$txt,[Text.Encoding]::UTF8) }
}

# --- EMI: fix labels/buttons + FAQ text
$emi = Join-Path . 'emi-calculator/index.html'
if(Test-Path $emi){
  Replace-InFile $emi @{
    '<label class="label" for="amount">Loan Amount \(.*?\)</label>' = '<label class="label" for="amount">Loan Amount (₹)</label>';
    'data-fill="amount" data-val="500000">.*?</button>' = 'data-fill="amount" data-val="500000">₹5L</button>';
    'data-fill="amount" data-val="1000000">.*?</button>' = 'data-fill="amount" data-val="1000000">₹10L</button>';
    'data-fill="amount" data-val="2500000">.*?</button>' = 'data-fill="amount" data-val="2500000">₹25L</button>';
    'id="prepayAmount" class="input" type="number" min="0" placeholder="Amount .*?"' = 'id="prepayAmount" class="input" type="number" min="0" placeholder="Amount (₹)"';
    'id="amount2" class="input" type="number" min="0" placeholder="Amount .*?"' = 'id="amount2" class="input" type="number" min="0" placeholder="Amount (₹)"';
    'id="calcBtn" class="btn">.*?</button>' = 'id="calcBtn" class="btn">Calculate</button>';
    'id="resetBtn" class="btn secondary">.*?</button>' = 'id="resetBtn" class="btn secondary">Reset</button>';
    'id="shareBtn" class="btn secondary">.*?</button>' = 'id="shareBtn" class="btn secondary">Copy Share Link</button>';
    'id="csvBtn" class="btn secondary">.*?</button>' = 'id="csvBtn" class="btn secondary">Download CSV</button>';
    'id="toggleSchedule" class="btn ghost">.*?</button>' = 'id="toggleSchedule" class="btn ghost">Show Amortization Schedule</button>';
    'Loan Amount \(.*?\)' = 'Loan Amount (₹)';
    'Amount .*?\)' = 'Amount (₹)';
  }
  # Fix JSON-LD EMI formula & r=0 answer
  $emiTxt = Get-Content -Raw -LiteralPath $emi
  $emiTxt = [Regex]::Replace($emiTxt, '("name":"How is EMI calculated\?",\s*"acceptedAnswer":\{"@type":"Answer","text":").*?("\}\})', '$1EMI = P × r × (1 + r)^n / ((1 + r)^n − 1), where P is principal, r is monthly interest rate (annual rate/12/100), and n is number of months.$2')
  $emiTxt = [Regex]::Replace($emiTxt, '("name":"What if my interest rate is 0%\?",\s*"acceptedAnswer":\{"@type":"Answer","text":").*?("\}\})', '$1If r = 0, EMI = P / n (principal divided by number of months).$2')
  # Insert explainer before </main>
  $emiExpl = @"
    <section class="card" style="margin-top:16px">
      <h2>How this EMI calculator works</h2>
      <p>EMI is computed using the standard formula: EMI = P × r × (1 + r)^n / ((1 + r)^n − 1), where P is principal, r is monthly rate (annual rate/12/100), and n is number of months. The tool also computes total interest, total payment and an amortization schedule.</p>
      <h3>Example</h3>
      <p>₹10,00,000 at 9% p.a. for 240 months → r = 0.09/12 = 0.0075. EMI ≈ ₹8,997; total interest ≈ ₹11,59,280; total ≈ ₹21,59,280.</p>
      <p>Adding a one-time prepayment reduces principal at that month and the schedule is recomputed thereafter.</p>
    </section>
    <section class="card" style="margin-top:16px">
      <h2>FAQs</h2>
      <details><summary><b>What’s a good loan tenure?</b></summary><p>Shorter tenures reduce total interest but increase EMI. Pick an EMI that fits your budget with some buffer for rate hikes.</p></details>
      <details><summary><b>Fixed vs floating rates?</b></summary><p>Floating rates can change over time, altering EMI or tenure. This tool assumes a constant rate for simplicity.</p></details>
      <p class="note">Related tools: <a href="/fd-calculator/">FD Calculator</a> · <a href="/sip-calculator/">SIP Calculator</a> · <a href="/currency-converter/">Currency Converter</a></p>
    </section>
"@
  if($emiTxt -notmatch '<h2>How this EMI calculator works</h2>'){
    $emiTxt = $emiTxt -replace '</main>', "$emiExpl</main>"
    [IO.File]::WriteAllText($emi,$emiTxt,[Text.Encoding]::UTF8)
  }
}

# --- SIP: fix rupee labels/title and add explainer
$sip = Join-Path . 'sip-calculator/index.html'
if(Test-Path $sip){
  Replace-InFile $sip @{
    '<div class="tool-icon"[^>]*>.*?</div>' = '<div class="tool-icon" aria-hidden="true">₹</div>';
    'Monthly Investment \(.*?\)' = 'Monthly Investment (₹)';
    '<title>.*?</title>' = '<title>SIP Calculator (Index & MF Live Rates) – Free Online | UpTools</title>';
    'og:title" content=".*?"' = 'og:title" content="SIP Calculator (Index & MF Live Rates) – UpTools"';
  }
  $sipTxt = Get-Content -Raw -LiteralPath $sip
  $sipExpl = @"
    <section class="card" style="margin-top:16px">
      <h2>How this SIP calculator works</h2>
      <p>SIP future value is computed as FV = P × [((1 + r)^n − 1) / r] × (1 + r), where P is monthly investment, r is monthly return (annual/12/100), and n is total months. Step-up (if any) increases P at the chosen rate each year.</p>
      <h3>Example</h3>
      <p>₹5,000/month for 10 years at 12% p.a. → r = 0.12/12. FV ≈ ₹11.6 lakh.</p>
      <p>You can pull historical CAGR from indices or mutual funds to prefill the expected return.</p>
      <p class="note">Related tools: <a href="/fd-calculator/">FD Calculator</a> · <a href="/emi-calculator/">EMI Calculator</a> · <a href="/currency-converter/">Currency Converter</a></p>
    </section>
"@
  if($sipTxt -notmatch '<h2>How this SIP calculator works</h2>'){
    $sipTxt = $sipTxt -replace '</main>', "$sipExpl</main>"
    [IO.File]::WriteAllText($sip,$sipTxt,[Text.Encoding]::UTF8)
  }
}

# --- Currency Converter: fix chips and swap symbol, add explainer
$cc = Join-Path . 'currency-converter/index.html'
if(Test-Path $cc){
  Replace-InFile $cc @{
    '��, ' = ' ⇄ ';
    '>��\.' = '>⇄';
  }
  $ccTxt = Get-Content -Raw -LiteralPath $cc
  $ccExpl = @"
    <section class="card" style="margin-top:16px">
      <h2>How this currency converter works</h2>
      <p>It fetches a mid-market rate for the selected pair, optionally adds your fee/markup %, and computes the converted amount. Use Swap to flip From/To and Copy to share the result.</p>
      <p class="note">Related tools: <a href="/gst-calculator/">GST Calculator</a> · <a href="/income-tax-tool/">Income Tax</a> · <a href="/emi-calculator/">EMI</a></p>
    </section>
"@
  if($ccTxt -notmatch '<h2>How this currency converter works</h2>'){
    $ccTxt = $ccTxt -replace '</main>', "$ccExpl</main>"
    [IO.File]::WriteAllText($cc,$ccTxt,[Text.Encoding]::UTF8)
  }
}
