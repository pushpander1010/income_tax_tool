$ErrorActionPreference = 'Stop'

function Fix-File([string]$path) {
  $orig = Get-Content -Raw -LiteralPath $path
  # Reinterpret the current text as CP1252 bytes and decode as UTF-8 to repair mojibake
  $bytes = [Text.Encoding]::GetEncoding(1252).GetBytes($orig)
  $utf8  = [Text.Encoding]::UTF8.GetString($bytes)
  # Strip SUB (U+001A) control chars if any
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $utf8.ToCharArray()) { if ([int]$ch -ne 26) { [void]$sb.Append($ch) } }
  $clean = $sb.ToString()
  # Optional: normalize some symbols that could confuse tooling
  $clean = $clean.Replace('÷','/').Replace('–','-')
  if ($clean -ne $orig) { [IO.File]::WriteAllText($path, $clean, [Text.Encoding]::UTF8) }
}

Get-ChildItem -Recurse -Include *.html -File | ForEach-Object { Fix-File $_.FullName }

# Ensure ai-prompts uses module script for Vite
$ai = Join-Path (Get-Location) 'ai-prompts/index.html'
if (Test-Path $ai) {
  $t = Get-Content -Raw -LiteralPath $ai
  $t = [Regex]::Replace($t, '<script(\s+)src="/scripts/utils.js"', '<script type="module"$1src="/scripts/utils.js"')
  [IO.File]::WriteAllText($ai, $t, [Text.Encoding]::UTF8)
}

Write-Host "Re-encoding pass complete."

