# ============================================================
#  把 images 里的照片压到适合上网的大小，并生成缩略图
#  由 3-压缩新图片.bat 调用（不要直接双击本文件）
#  只处理 .jpg / .jpeg，logo 和二维码不动
# ============================================================

param(
    [string]$Root = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

if ([string]::IsNullOrWhiteSpace($Root)) {
    $Root = Split-Path -Parent $PSScriptRoot
}
$Root = $Root.TrimEnd('\')

$imgDir   = Join-Path $Root "images"
$thumbDir = Join-Path $imgDir "thumbs"

if (-not (Test-Path $imgDir)) { throw "找不到 images 文件夹：$imgDir" }
if (-not (Test-Path $thumbDir)) { New-Item -ItemType Directory -Path $thumbDir | Out-Null }

$FULL_MAX  = 1800
$THUMB_MAX = 800
$FULL_Q    = 82
$THUMB_Q   = 78
$FULL_BIG  = 700KB

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
         Where-Object { $_.MimeType -eq "image/jpeg" } |
         Select-Object -First 1
if ($null -eq $codec) { throw "系统里找不到 JPEG 编码器" }

# 按 EXIF 里的方向标记摆正（手机/相机竖拍的照片会用这个）
function Get-RotateFlip($img) {
    $orientation = 1
    foreach ($p in $img.PropertyItems) {
        if ($p.Id -eq 0x0112 -and $p.Len -ge 2) {
            $orientation = [BitConverter]::ToUInt16($p.Value, 0)
            break
        }
    }
    switch ($orientation) {
        2 { [System.Drawing.RotateFlipType]::RotateNoneFlipX }
        3 { [System.Drawing.RotateFlipType]::Rotate180FlipNone }
        4 { [System.Drawing.RotateFlipType]::RotateNoneFlipY }
        5 { [System.Drawing.RotateFlipType]::Rotate90FlipX }
        6 { [System.Drawing.RotateFlipType]::Rotate90FlipNone }
        7 { [System.Drawing.RotateFlipType]::Rotate270FlipX }
        8 { [System.Drawing.RotateFlipType]::Rotate270FlipNone }
        default { $null }
    }
}

function Save-Jpeg($srcPath, $dstPath, $maxSide, $quality) {
    $img = [System.Drawing.Image]::FromFile($srcPath)
    $tmp = "$dstPath.tmp"
    try {
        $w = $img.Width
        $h = $img.Height
        if ($w -lt 1 -or $h -lt 1) { throw "图片尺寸异常" }

        $longest = [Math]::Max($w, $h)
        $scale = 1.0
        if ($longest -gt $maxSide) { $scale = $maxSide / $longest }

        $nw = [int][Math]::Round($w * $scale)
        $nh = [int][Math]::Round($h * $scale)
        if ($nw -lt 1) { $nw = 1 }
        if ($nh -lt 1) { $nh = 1 }

        $bmp = New-Object System.Drawing.Bitmap($nw, $nh)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.DrawImage($img, 0, 0, $nw, $nh)
        $g.Dispose()

        $flip = Get-RotateFlip $img
        if ($null -ne $flip) { $bmp.RotateFlip($flip) }

        $enc = New-Object System.Drawing.Imaging.EncoderParameters(1)
        $enc.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
            [System.Drawing.Imaging.Encoder]::Quality, [long]$quality)

        $bmp.Save($tmp, $codec, $enc)
        $bmp.Dispose()
        $enc.Dispose()
    }
    finally {
        $img.Dispose()
    }
    Move-Item -Force $tmp $dstPath
}

$photos = Get-ChildItem -Path $imgDir -File |
          Where-Object { $_.Extension -match '^\.(jpg|jpeg)$' }

if ($photos.Count -eq 0) {
    Write-Host "  images 里没有 .jpg 照片。"
    exit 0
}

Write-Host ("  找到 {0} 张照片" -f $photos.Count)
Write-Host ""

$ok = 0
$bad = 0

foreach ($p in $photos) {
    try {
        $before = [Math]::Round($p.Length / 1KB)

        if ($p.Length -gt $FULL_BIG) {
            Save-Jpeg $p.FullName $p.FullName $FULL_MAX $FULL_Q
        }

        $thumb = Join-Path $thumbDir $p.Name
        Save-Jpeg $p.FullName $thumb $THUMB_MAX $THUMB_Q

        $after = [Math]::Round((Get-Item $p.FullName).Length / 1KB)
        Write-Host ("   {0}   {1} KB  ->  {2} KB" -f $p.Name, $before, $after)
        $ok++
    }
    catch {
        Write-Host ("   [跳过] {0}：{1}" -f $p.Name, $_.Exception.Message)
        $bad++
    }
}

Write-Host ""
Write-Host ("  完成：成功 {0} 张，跳过 {1} 张" -f $ok, $bad)
Write-Host ""
