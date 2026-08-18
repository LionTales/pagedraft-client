<#
    regen-show-icons.ps1

    Regenerates Show's two derived dock/chat assets from the 1024x1024 source artwork at
    src/.cursor/designs/show.png (outside this repo, in the PageDraft workspace root).

    WHY THIS EXISTS (f1, 2026-08-18): both derived PNGs were previously hand-cropped close to
    edge-to-edge, so the CSS's own circular mask (border-radius: var(--pd-radius-pill) over a
    square box, i.e. a circle inscribed in the square) clipped the top of the book pages and the
    head. The fix is not a smaller crop of the same framing - it is padding: draw the WHOLE source
    image (which already carries its own transparent margin) scaled down to ~76% of the target
    canvas and centred, so every point of the artwork clears the inscribed circle with margin to
    spare.

    ImageMagick is NOT installed on this machine and must not be installed to run this. This script
    uses pure .NET System.Drawing (GDI+) instead - it ships with Windows PowerShell, needs no
    external dependency, and is the sanctioned derivation going forward. Do not hand-crop these
    assets again; re-run this script after any source-art update.

    Usage:
        pwsh ./tools/regen-show-icons.ps1
        pwsh ./tools/regen-show-icons.ps1 -ScalePercent 72   # if 76 crowds the 18px tab mount

    Sizes:
        show-header.png  96x96  (dock launcher, drawn at 32px; product-chat empty state at 56px)
        show-tab.png      48x48  (dock assistant tab, drawn at 18px)

    Scale: the artwork is scaled to ScalePercent of the target canvas and centred, so an inscribed
    circle (the CSS mask) never touches the art. 76% was verified by eye at all three mount sizes
    (32px launcher, 18px tab, 56px chat empty state) at :4201 on 2026-08-18 - nothing clipped, so
    the fallback 72% was not needed.
#>

[CmdletBinding()]
param(
    [string]$SourcePath,
    [string]$HeaderOutPath,
    [string]$TabOutPath,
    [int]$HeaderSize = 96,
    [int]$TabSize = 48,
    [double]$ScalePercent = 76
)

# $PSScriptRoot is unreliable inside a param() default-value expression depending on how the
# script is invoked (dot-sourced vs -File vs called from a wrapping shell), so resolve the
# script's own directory explicitly here instead and fill in any unset path defaults from it.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $SourcePath) { $SourcePath = Join-Path $scriptDir '../../.cursor/designs/show.png' }
if (-not $HeaderOutPath) { $HeaderOutPath = Join-Path $scriptDir '../public/assistant/show-header.png' }
if (-not $TabOutPath) { $TabOutPath = Join-Path $scriptDir '../public/assistant/show-tab.png' }

Add-Type -AssemblyName System.Drawing

function New-PaddedIcon {
    param(
        [System.Drawing.Image]$SourceImage,
        [int]$CanvasSize,
        [double]$ScalePercent,
        [string]$OutPath
    )

    $drawnSize = [Math]::Round($CanvasSize * ($ScalePercent / 100.0))
    $offset = [Math]::Round(($CanvasSize - $drawnSize) / 2.0)

    $canvas = New-Object System.Drawing.Bitmap $CanvasSize, $CanvasSize, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    try {
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $destRect = New-Object System.Drawing.Rectangle $offset, $offset, $drawnSize, $drawnSize
        $graphics.DrawImage($SourceImage, $destRect)
    } finally {
        $graphics.Dispose()
    }

    $outDir = Split-Path -Parent $OutPath
    if (-not (Test-Path $outDir)) {
        New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    }
    $canvas.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $canvas.Dispose()
    Write-Output "Wrote $OutPath ($CanvasSize x $CanvasSize, art at $ScalePercent% = ${drawnSize}px, offset ${offset}px)"
}

$resolvedSource = (Resolve-Path $SourcePath).Path
Write-Output "Source: $resolvedSource"
$source = [System.Drawing.Bitmap]::FromFile($resolvedSource)
try {
    New-PaddedIcon -SourceImage $source -CanvasSize $HeaderSize -ScalePercent $ScalePercent -OutPath $HeaderOutPath
    New-PaddedIcon -SourceImage $source -CanvasSize $TabSize -ScalePercent $ScalePercent -OutPath $TabOutPath
} finally {
    $source.Dispose()
}
