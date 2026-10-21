# 从 logo 自动裁出网站图标（无需手动裁图）
# 用法：由 2-生成网站图标.bat 调用，不要直接双击本文件

param(
    [string]$Root = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

if ([string]::IsNullOrWhiteSpace($Root)) {
    $Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
}
$Root = $Root.TrimEnd('\')
$imgDir = Join-Path $Root "images"

# ---------- 找 logo ----------
$candidates = @("mspa透明底.png", "nmspa.png", "mspa.png", "logo.png")
$srcPath = $null
foreach ($c in $candidates) {
    $p = Join-Path $imgDir $c
    if (Test-Path $p) { $srcPath = $p; break }
}
if ($null -eq $srcPath) {
    throw "在 images 文件夹里找不到 logo（mspa透明底.png / nmspa.png）"
}

Write-Host "  使用 logo: $srcPath"

$src = [System.Drawing.Bitmap]::FromFile($srcPath)
$W = $src.Width
$H = $src.Height

# ---------- 缩略图扫描，找出图案真实边界 ----------
$tw = 400
$th = [int][math]::Round($H * $tw / $W)
if ($th -lt 1) { $th = 1 }

$thumb = New-Object System.Drawing.Bitmap $tw, $th
$g = [System.Drawing.Graphics]::FromImage($thumb)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($src, 0, 0, $tw, $th)
$g.Dispose()

# 先判断背景是否透明
$transparentCount = 0
for ($y = 0; $y -lt $th; $y += 2) {
    for ($x = 0; $x -lt $tw; $x += 2) {
        if ($thumb.GetPixel($x, $y).A -lt 16) { $transparentCount++ }
    }
}
$sampled = [math]::Ceiling($tw / 2) * [math]::Ceiling($th / 2)
$useAlpha = ($transparentCount -gt ($sampled * 0.02))

$minX = $tw; $minY = $th; $maxX = -1; $maxY = -1

for ($y = 0; $y -lt $th; $y++) {
    for ($x = 0; $x -lt $tw; $x++) {
        $p = $thumb.GetPixel($x, $y)

        if ($useAlpha) {
            $hit = ($p.A -gt 24)
        } else {
            $lum = 0.299 * $p.R + 0.587 * $p.G + 0.114 * $p.B
            $hit = ($lum -gt 36)
        }

        if ($hit) {
            if ($x -lt $minX) { $minX = $x }
            if ($x -gt $maxX) { $maxX = $x }
            if ($y -lt $minY) { $minY = $y }
            if ($y -gt $maxY) { $maxY = $y }
        }
    }
}
$thumb.Dispose()

if ($maxX -lt 0) { throw "logo 里没有找到可见图案，无法裁切" }

Write-Host "  图案区域: X $minX-$maxX / Y $minY-$maxY （缩略图坐标）"

# 换算回原图
$scale = $W / $tw
$x0 = [int][math]::Floor($minX * $scale)
$y0 = [int][math]::Floor($minY * $scale)
$x1 = [int][math]::Ceiling(($maxX + 1) * $scale)
$y1 = [int][math]::Ceiling(($maxY + 1) * $scale)

$bw = [math]::Max(1, $x1 - $x0)
$bh = [math]::Max(1, $y1 - $y0)

# 取正方形 + 18% 留白
$side = [int][math]::Round([math]::Max($bw, $bh) * 1.18)
$cx = ($x0 + $x1) / 2
$cy = ($y0 + $y1) / 2
$cx0 = [int][math]::Round($cx - $side / 2)
$cy0 = [int][math]::Round($cy - $side / 2)

# 允许越界：先画到一张足够大的画布
$pad = [math]::Max(0, [math]::Max(-$cx0, -$cy0))
$canvas = New-Object System.Drawing.Bitmap ($side + $pad * 2), ($side + $pad * 2)
$gc = [System.Drawing.Graphics]::FromImage($canvas)
$gc.Clear([System.Drawing.Color]::Transparent)
$gc.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$destRect = New-Object System.Drawing.Rectangle ($cx0 + $pad), ($cy0 + $pad), $side, $side
$gc.DrawImage($src, $destRect)
$gc.Dispose()

# ---------- 生成 favicon.png（256，保留透明） ----------
$fav = New-Object System.Drawing.Bitmap 256, 256
$gf = [System.Drawing.Graphics]::FromImage($fav)
$gf.Clear([System.Drawing.Color]::Transparent)
$gf.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gf.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$gf.DrawImage($canvas, 0, 0, 256, 256)
$gf.Dispose()

$favPath = Join-Path $imgDir "favicon.png"
$fav.Save($favPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "  已生成: $favPath"

# ---------- 生成 apple-touch-icon.png（180，深色底，iOS 用） ----------
$touch = New-Object System.Drawing.Bitmap 180, 180
$gt = [System.Drawing.Graphics]::FromImage($touch)
$gt.Clear([System.Drawing.Color]::FromArgb(255, 16, 17, 19))
$gt.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$inner = [int][math]::Round(180 * 0.84)
$off = [int][math]::Round((180 - $inner) / 2)
$gt.DrawImage($fav, $off, $off, $inner, $inner)
$gt.Dispose()

$touchPath = Join-Path $imgDir "apple-touch-icon.png"
$touch.Save($touchPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "  已生成: $touchPath"

# ---------- 清理 ----------
$fav.Dispose()
$touch.Dispose()
$canvas.Dispose()
$src.Dispose()

Write-Host ""
Write-Host "  完成。"
