# generate-icon.ps1
# Generate multi-resolution ICO (16/24/32/48/64/128/256 px) using System.Drawing
# Usage: powershell -ExecutionPolicy Bypass -File scripts/generate-icon.ps1

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$assetsDir = Join-Path $projectRoot "assets"
$icoPath = Join-Path $assetsDir "icon.ico"

if (-not (Test-Path $assetsDir)) {
    New-Item -ItemType Directory -Path $assetsDir -Force | Out-Null
}

Add-Type -AssemblyName System.Drawing

$sizes = @(16, 24, 32, 48, 64, 128, 256)

function New-MasterBitmap {
    $w = 256; $h = 256
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = "HighQuality"
    $g.TextRenderingHint = "AntiAliasGridFit"

    # Background: dark slate rounded rect
    $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(30, 35, 50))
    $inner = New-Object System.Drawing.Rectangle(16, 16, $w - 32, $h - 32)
    $g.FillRectangle($bgBrush, $inner)

    # Accent bars: blue
    $accentColor = [System.Drawing.Color]::FromArgb(99, 130, 255)
    $accentBrush = New-Object System.Drawing.SolidBrush($accentColor)
    $accentRect = New-Object System.Drawing.Rectangle($w - 80, 0, 80, 6)
    $g.FillRectangle($accentBrush, $accentRect)
    $accentRect2 = New-Object System.Drawing.Rectangle(0, $h - 6, 80, 6)
    $g.FillRectangle($accentBrush, $accentRect2)

    # Main text "AI"
    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $font = New-Object System.Drawing.Font("Segoe UI", 96, [System.Drawing.FontStyle]::Bold)
    $textRect = New-Object System.Drawing.RectangleF(0, 30, $w, $h - 60)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = "Center"
    $format.LineAlignment = "Center"
    $g.DrawString("AI", $font, $textBrush, $textRect, $format)

    # Sub text (Chinese translation mark)
    $subFont = New-Object System.Drawing.Font("Microsoft YaHei", 32, [System.Drawing.FontStyle]::Regular)
    $subRect = New-Object System.Drawing.RectangleF($w - 60, $h - 70, 50, 50)
    $subFormat = New-Object System.Drawing.StringFormat
    $subFormat.Alignment = "Center"; $subFormat.LineAlignment = "Center"
    $g.DrawString([char]0x8BD1, $subFont, $textBrush, $subRect, $subFormat)

    $g.Dispose()
    $bgBrush.Dispose(); $accentBrush.Dispose(); $textBrush.Dispose()
    $font.Dispose(); $subFont.Dispose(); $format.Dispose(); $subFormat.Dispose()

    return $bmp
}

function Write-IcoFile {
    param([System.Drawing.Bitmap[]]$pngs, [string]$path)

    $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
    $writer = New-Object System.IO.BinaryWriter($stream)

    # ICO header: reserved(2) + type(2=ICO) + count(2)
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$pngs.Count)

    # Calculate offsets past the header + entries
    $headerSize = 6 + 16 * $pngs.Count
    $offsets = @()
    $allData = @()
    $currentOffset = $headerSize
    foreach ($png in $pngs) {
        $memStream = New-Object System.IO.MemoryStream
        $png.Save($memStream, [System.Drawing.Imaging.ImageFormat]::Png)
        $data = $memStream.ToArray()
        $memStream.Dispose()
        $allData += ,$data
        $offsets += $currentOffset
        $currentOffset += $data.Length
    }

    # Write directory entries (16 bytes each)
    for ($i = 0; $i -lt $pngs.Count; $i++) {
        $size = [Math]::Min($pngs[$i].Width, 256)
        if ($size -eq 256) { $size = 0 }  # ICO uses 0 to mean 256

        $writer.Write([Byte]$size)
        $writer.Write([Byte]$size)
        $writer.Write([Byte]0)
        $writer.Write([Byte]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]32)
        $writer.Write([UInt32]$allData[$i].Length)
        $writer.Write([UInt32]$offsets[$i])
    }

    # Write PNG data
    for ($i = 0; $i -lt $allData.Count; $i++) {
        $writer.Write($allData[$i])
    }

    $writer.Dispose()
    $stream.Dispose()
}

# Main
try {
    Write-Host "[generate-icon] Creating master bitmap 256x256..."
    $master = New-MasterBitmap

    $pngs = @()
    foreach ($size in $sizes) {
        Write-Host "[generate-icon] Resizing to ${size}x${size}..."
        $resized = New-Object System.Drawing.Bitmap($master, $size, $size)
        $pngs += $resized
    }

    Write-Host "[generate-icon] Writing ICO to: $icoPath"
    Write-IcoFile -pngs $pngs -path $icoPath

    $sizeList = ($sizes -join ', ')
    Write-Host "[generate-icon] Done! Multi-resolution ICO created: $sizeList"
    Write-Host "[generate-icon] File: $icoPath"
} catch {
    Write-Error "[generate-icon] Failed: $_"
    exit 1
} finally {
    if ($master) { $master.Dispose() }
}
