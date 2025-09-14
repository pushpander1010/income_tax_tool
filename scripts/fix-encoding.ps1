$ErrorActionPreference = 'Stop'

function Clean-Text([string]$s) {
  if (-not $s) { return $s }
  # Replace common UTF-8 mis-decoded sequences with intended glyphs or ASCII
  $pairs = @{
    'Ã—' = '×';  # times
    'Ã.' = '/';  # divide -> ascii slash for safety
    'âˆ’' = '-'; # minus
    'Â.' = '.';  # middle dot
    'Â©' = '©';
    'â‚¹' = '₹';  # INR
    'Â£' = '£';
    'Â¥' = '¥';
    'â‚©' = '₩';
    'â‚º' = '₺';
    'â‚½' = '½';
    'Â.' = '.';
    'Â'  = '';   # stray A-circumflex often preceding symbols
  }
  foreach ($k in $pairs.Keys) { $s = $s.Replace($k, $pairs[$k]) }
  # Strip SUB control chars (U+001A)
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $s.ToCharArray()) { if ([int]$ch -ne 26) { [void]$sb.Append($ch) } }
  return $sb.ToString()
}

function Clean-File([string]$path) {
  $txt = Get-Content -Raw -LiteralPath $path
  $clean = Clean-Text $txt
  if ($clean -ne $txt) {
    [IO.File]::WriteAllText($path, $clean, [Text.Encoding]::UTF8)
  }
}

# Clean all HTML files (source and dist)
Get-ChildItem -Recurse -Include *.html -File | ForEach-Object { Clean-File $_.FullName }

# Ensure ai-prompts uses module script so Vite can bundle
$ai = Join-Path (Get-Location) 'ai-prompts/index.html'
if (Test-Path $ai) {
  $t = Get-Content -Raw -LiteralPath $ai
  $t = [Regex]::Replace($t, '<script(\s+)src="/scripts/utils.js"', '<script type="module"$1src="/scripts/utils.js"')
  [IO.File]::WriteAllText($ai, $t, [Text.Encoding]::UTF8)
}

Write-Host "Encoding cleanup complete."

