param([string]$Root = '.')
$ErrorActionPreference = 'Stop'

# Generic replacements across HTML
$replacements = @{
  '(\()�,1(\))' = '$1₹$2';
  '>�,1<' = '>₹<';
  '�,11' = '₹1';
  'Custom�?�' = 'Custom…';
}

# Apply to all HTML files
$files = Get-ChildItem -Path $Root -Recurse -Include *.html -File
foreach ($f in $files) {
  $txt = Get-Content -Raw -LiteralPath $f.FullName
  $orig = $txt
  foreach ($kvp in $replacements.GetEnumerator()) {
    $txt = [Regex]::Replace($txt, $kvp.Key, $kvp.Value)
  }
  if ($txt -ne $orig) {
    [IO.File]::WriteAllText($f.FullName, $txt, [Text.Encoding]::UTF8)
  }
}

# Targeted Income Tax fixes
$it = Join-Path $Root 'income-tax-tool\index.html'
if (Test-Path $it) {
  $txt = Get-Content -Raw -LiteralPath $it
  $orig = $txt
  $txt = $txt -replace '<div class="tool-icon">.*?</div>', '<div class="tool-icon">₹</div>'
  $txt = $txt -replace 'Annual Gross Income \(.*?\)', 'Annual Gross Income (₹)'
  $txt = $txt -replace 'Include standard deduction\s*\(.*?\)', 'Include standard deduction (₹50,000)'
  $txt = $txt -replace 'Section 80C \(.*?1,50,000\)', 'Section 80C (max ₹1,50,000)'
  $txt = $txt -replace 'Section 80D - Health Insurance \(.*?\)', 'Section 80D - Health Insurance (₹)'
  $txt = $txt -replace 'NPS \(80CCD\(1B\)\) \(.*?50,000\)', 'NPS (80CCD(1B)) (max ₹50,000)'
  $txt = $txt -replace 'Basic Salary \(.*?/year\)', 'Basic Salary (₹/year)'
  $txt = $txt -replace 'HRA Received \(.*?/year\)', 'HRA Received (₹/year)'
  $txt = $txt -replace 'Rent Paid \(.*?/year\)', 'Rent Paid (₹/year)'
  $txt = $txt -replace 'Interest paid \(.*?/year\)', 'Interest paid (₹/year)'
  $txt = $txt -replace 'home-loan interest set-off up to .*? for self-occupied', 'home-loan interest set-off up to ₹2,00,000 for self-occupied'
  $txt = $txt -replace '87A rebate \(.*?new.*?old\)', '87A rebate (₹7L new / ₹5L old)'
  $txt = $txt -replace 'New regime has lower slab rates and .*? standard deduction', 'New regime has lower slab rates and ₹50,000 standard deduction'
  $txt = $txt -replace 'if total income is up to .*?, tax after rebate is .*?\.', 'if total income is up to ₹7,00,000, tax after rebate is ₹0.'
  $txt = $txt -replace 'if total income is up to .*?, tax after rebate is .*?\.', 'if total income is up to ₹5,00,000, tax after rebate is ₹0.'
  $txt = $txt -replace 'over: 50000000', 'over: 5000000'
  $txt = $txt -replace 'over: 100000000', 'over: 10000000'
  $txt = $txt -replace 'over: 200000000', 'over: 20000000'
  $txt = $txt -replace 'over: 500000000', 'over: 50000000'
  $txt = $txt -replace '�,1\$\{rs\(', '₹${rs('
  $txt = $txt -replace '<footer class="note small site-footer"[^>]*>.*?<\/footer>', '    <footer class="note small site-footer" role="contentinfo">© <span id="y"></span> UpTools · <a href="/sitemap.xml">Sitemap</a></footer>'
  if ($txt -ne $orig) { [IO.File]::WriteAllText($it, $txt, [Text.Encoding]::UTF8) }
}

# Targeted GST fixes
$gst = Join-Path $Root 'gst-calculator\index.html'
if (Test-Path $gst) {
  $txt = Get-Content -Raw -LiteralPath $gst
  $orig = $txt
  $txt = $txt -replace 'Amount \(.*?\)', 'Amount (₹)'
  $txt = $txt -replace 'Nearest .*?1', 'Nearest ₹1'
  $txt = $txt -replace 'Custom�?�', 'Custom…'
  if ($txt -ne $orig) { [IO.File]::WriteAllText($gst, $txt, [Text.Encoding]::UTF8) }
}
