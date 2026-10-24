# Generate images/thumbs-400/ -- a 400px-wide tier of the wall thumbnails.
#
# Why: the wall is 2 columns on a phone (~180 CSS px per photo) but thumbs are
# 800px, so a phone downloads roughly 4x the pixels it can show. The home page
# therefore pulls ~600 KB of thumbnails. With <img srcset> the browser picks the
# 400px file on phones and keeps the 800px one on desktop.
#
# When to run: after adding photos / regenerating thumbs (3-...bat).
#   powershell -ExecutionPolicy Bypass -File tools/make-thumb-400.ps1

param([string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path)

Add-Type -AssemblyName System.Drawing

$src = Join-Path $Root 'images\thumbs'
$dst = Join-Path $Root 'images\thumbs-400'
if (-not (Test-Path $src)) {
  Write-Host 'images\thumbs not found - run the compress bat first.' -ForegroundColor Red
  exit 1
}
if (-not (Test-Path $dst)) { New-Item -ItemType Directory -Path $dst | Out-Null }

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
  Where-Object { $_.MimeType -eq 'image/jpeg' }
$quality = [System.Drawing.Imaging.Encoder]::Quality
$width = 400

$made = 0
$saved = 0

Get-ChildItem -Path $src -File |
  Where-Object { $_.Extension -match '^\.(jpg|jpeg|png)$' } |
  ForEach-Object {
    $out = Join-Path $dst $_.Name
    if ((Test-Path $out) -and ((Get-Item $out).LastWriteTime -ge $_.LastWriteTime)) { return }

    $img = [System.Drawing.Image]::FromFile($_.FullName)
    try {
      if ($img.Width -le $width) {
        # already small enough, just copy
        Copy-Item $_.FullName $out -Force
        $made++
        return
      }
      $h = [int][Math]::Round($img.Height * $width / $img.Width)
      $bmp = New-Object System.Drawing.Bitmap($width, $h)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      try {
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $g.DrawImage($img, 0, 0, $width, $h)
      } finally { $g.Dispose() }

      $params = New-Object System.Drawing.Imaging.EncoderParameters(1)
      $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter($quality, [long]74)
      $bmp.Save($out, $codec, $params)
      $bmp.Dispose()
      $params.Dispose()
      $made++
      $saved += [int](($_.Length - (Get-Item $out).Length) / 1KB)
    } finally { $img.Dispose() }
  }

Write-Host ("done: {0} files -> {1} (freed about {2} KB per full load)" -f $made, $dst, $saved) -ForegroundColor Green
