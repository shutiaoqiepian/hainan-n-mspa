# Generate responsive sizes for the hero photo (Windows System.Drawing, no deps).
#
# Why: the hero photo is 2200 px / 460 KB and is the largest single file on the
# site, so it decides mobile LCP. A phone only needs ~800-1000 px.
# The browser picks with <img srcset>; desktop keeps the original, so quality
# on a big screen is unchanged.
#
# Run after changing the hero photo:
#   powershell -ExecutionPolicy Bypass -File tools/make-hero-sizes.ps1
#
# NOTE when you swap the hero: also update
#   - src/data/photos.ts  (HERO_IMAGE)
#   - src/pages/HomePage.vue (heroSrcset widths)
#   - src/shells/index.html (the inline preload thresholds)

param([string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path)

Add-Type -AssemblyName System.Drawing

$src = Join-Path $Root 'images\10.4世纪大烧重制.jpg'
if (-not (Test-Path $src)) {
  Write-Host "hero source not found: $src" -ForegroundColor Red
  exit 1
}

# width -> jpeg quality. Phones get 1000 px at a higher quality because the
# gradient sky shows compression mush very easily.
$tiers = @(
  @{ width = 1400; quality = 82 },
  @{ width = 1000; quality = 85 }
)

$image = [System.Drawing.Image]::FromFile($src)
try {
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
    Where-Object { $_.MimeType -eq 'image/jpeg' }
  $qualityEncoder = [System.Drawing.Imaging.Encoder]::Quality

  foreach ($tier in $tiers) {
    $width = $tier.width
    $height = [int][Math]::Round($image.Height * $width / $image.Width)
    $bmp = New-Object System.Drawing.Bitmap($width, $height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $g.DrawImage($image, 0, 0, $width, $height)
    } finally {
      $g.Dispose()
    }

    $params = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter($qualityEncoder, [long]$tier.quality)

    $out = Join-Path $Root ("images\hero-{0}.jpg" -f $width)
    $bmp.Save($out, $codec, $params)
    $bmp.Dispose()
    $params.Dispose()

    $kb = [Math]::Round((Get-Item $out).Length / 1KB)
    Write-Host ("OK  {0}  {1}x{2}  q{3}  {4} KB" -f $out, $width, $height, $tier.quality, $kb)
  }
} finally {
  $image.Dispose()
}

# remove the old 900 px tier if it is still around
$old = Join-Path $Root 'images\hero-900.jpg'
if (Test-Path $old) { Remove-Item $old -Force; Write-Host 'removed old hero-900.jpg' }

Write-Host 'done. original untouched; desktop still uses it.' -ForegroundColor Green
