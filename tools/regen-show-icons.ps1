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

    THE PAGE-FLIP SPRITE (f2, 8b, 2026-08-18): the same source also drives `show-flip-sprite.png`, a
    horizontal strip of 6 frames in which the book's RIGHT PAGE turns over onto the left. Frame 0 is
    byte-for-byte the same composite as `show-header.png`, which is what lets the CSS park an overlay
    on frame 0 for most of its cycle and stay invisible there (see app-dock.component.scss).

    HOW THE PAGE IS MOVED, stated plainly because it constrains what this can ever look like:
    System.Drawing gives an AFFINE transform only (a 2x3 matrix - `Graphics.DrawImage` with three
    destination points is a parallelogram, not a quad), so this is a horizontal SQUASH about the spine
    plus a small rotation. It is NOT a perspective flip: the page's far edge does not foreshorten
    independently of its near edge, and no page curl is possible. That happens to be defensible here -
    for a page rotating about a truly vertical spine under an orthographic camera, a pure horizontal
    scale IS the correct projection - but the icon's book is drawn fanned open rather than flat, so the
    match is approximate and the small rotation is artistic licence, not physics.

    The scale runs 1 -> -1 (`cos(pi*t)`), so the page passes through a vertical sliver at t=0.5 and
    lands MIRRORED on the left half, where the artwork is near-symmetric, so the final frame nearly
    coincides with the resting left page and the cycle can loop back to frame 0 without a visible snap.
    The moving page is darkened slightly at mid-turn (a turning leaf catches less light), which is the
    only thing separating it from the page beneath it at 32px.

    Usage:
        pwsh ./tools/regen-show-icons.ps1
        pwsh ./tools/regen-show-icons.ps1 -ScalePercent 72   # if 76 crowds the 18px tab mount
        pwsh ./tools/regen-show-icons.ps1 -DebugFramesDir C:\some\dir   # also dump 256px frames

    Sizes:
        show-header.png       96x96    (dock launcher, drawn at 32px; product-chat empty state at 56px)
        show-tab.png          48x48    (dock assistant tab, drawn at 18px)
        show-flip-sprite.png  576x96   (6 x 96, the launcher's flip overlay)

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
    [string]$SpriteOutPath,
    [int]$HeaderSize = 96,
    [int]$TabSize = 48,
    [double]$ScalePercent = 76,

    # Where in the 1024x1024 source the book's RIGHT PAGE lives, as a polygon: spine-top,
    # outer-top, outer-bottom, spine-bottom. Read off a 3x zoom of the source with a 20px grid on
    # 2026-08-18. Deliberately stops ABOVE the navy band that outlines the book's lower edge, so the
    # outline stays put and only the cream leaf moves.
    [int[]]$RightPagePolygon = @(512, 342,  765, 297,  778, 402,  512, 428),

    # The spine, i.e. the axis the page turns about.
    [int]$SpineX = 512,
    [int]$SpineY = 392,

    # The turn, sampled at these phases of a half rotation (t in 0..1, scaleX = cos(pi*t)). Frame 0 is
    # the resting icon and carries no moving page at all.
    [double[]]$FramePhases = @(0.28, 0.46, 0.62, 0.80, 0.93),

    # Peak tilt of the moving leaf, degrees, scaled by sin(pi*t) so it is 0 at rest and at landing.
    [double]$TiltDegrees = 7,

    # Peak darkening of the moving leaf (0 = none, 1 = black) - the only depth cue at 32px.
    [double]$ShadeStrength = 0.22,

    # Optional: also write each frame upscaled to this size, one PNG per frame, for human review.
    [string]$DebugFramesDir,
    [int]$DebugFrameSize = 256
)

# $PSScriptRoot is unreliable inside a param() default-value expression depending on how the
# script is invoked (dot-sourced vs -File vs called from a wrapping shell), so resolve the
# script's own directory explicitly here instead and fill in any unset path defaults from it.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $SourcePath) { $SourcePath = Join-Path $scriptDir '../../.cursor/designs/show.png' }
if (-not $HeaderOutPath) { $HeaderOutPath = Join-Path $scriptDir '../public/assistant/show-header.png' }
if (-not $TabOutPath) { $TabOutPath = Join-Path $scriptDir '../public/assistant/show-tab.png' }
if (-not $SpriteOutPath) { $SpriteOutPath = Join-Path $scriptDir '../public/assistant/show-flip-sprite.png' }

Add-Type -AssemblyName System.Drawing

function New-QualityGraphics {
    param([System.Drawing.Image]$Target)

    $g = [System.Drawing.Graphics]::FromImage($Target)
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    return $g
}

function Ensure-OutDir {
    param([string]$OutPath)

    $outDir = Split-Path -Parent $OutPath
    if ($outDir -and -not (Test-Path $outDir)) {
        New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    }
}

<#
    Draw the artwork padded and centred into an existing canvas at (OriginX, OriginY). Every derived
    asset goes through this one function, which is what makes frame 0 of the sprite identical to
    show-header.png rather than merely similar.
#>
function Add-PaddedIcon {
    param(
        [System.Drawing.Graphics]$Graphics,
        [System.Drawing.Image]$SourceImage,
        [int]$OriginX,
        [int]$OriginY,
        [int]$CanvasSize,
        [double]$ScalePercent
    )

    $drawnSize = [Math]::Round($CanvasSize * ($ScalePercent / 100.0))
    $offset = [Math]::Round(($CanvasSize - $drawnSize) / 2.0)
    $destRect = New-Object System.Drawing.Rectangle ($OriginX + $offset), ($OriginY + $offset), $drawnSize, $drawnSize
    $Graphics.DrawImage($SourceImage, $destRect)
    return @{ DrawnSize = $drawnSize; Offset = $offset }
}

function New-PaddedIcon {
    param(
        [System.Drawing.Image]$SourceImage,
        [int]$CanvasSize,
        [double]$ScalePercent,
        [string]$OutPath
    )

    $canvas = New-Object System.Drawing.Bitmap $CanvasSize, $CanvasSize, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = New-QualityGraphics -Target $canvas
    $info = $null
    try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $info = Add-PaddedIcon -Graphics $graphics -SourceImage $SourceImage -OriginX 0 -OriginY 0 -CanvasSize $CanvasSize -ScalePercent $ScalePercent
    } finally {
        $graphics.Dispose()
    }

    Ensure-OutDir -OutPath $OutPath
    $canvas.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $canvas.Dispose()
    Write-Output "Wrote $OutPath ($CanvasSize x $CanvasSize, art at $ScalePercent% = $($info.DrawnSize)px, offset $($info.Offset)px)"
}

<#
    Isolate the book's right page onto its own transparent 1024 layer, by clipping the source to the
    polygon. Everything the flip moves lives on this layer; everything it does not move stays on the
    untouched base image underneath, which is what supplies the "page beneath the one turning".
#>
function New-RightPageLayer {
    param(
        [System.Drawing.Image]$SourceImage,
        [int[]]$Polygon
    )

    $points = @()
    for ($i = 0; $i -lt $Polygon.Length; $i += 2) {
        $points += (New-Object System.Drawing.Point $Polygon[$i], $Polygon[$i + 1])
    }

    $layer = New-Object System.Drawing.Bitmap $SourceImage.Width, $SourceImage.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = New-QualityGraphics -Target $layer
    try {
        $g.Clear([System.Drawing.Color]::Transparent)
        $path = New-Object System.Drawing.Drawing2D.GraphicsPath
        $path.AddPolygon([System.Drawing.Point[]]$points)
        $g.SetClip($path)
        $g.DrawImage($SourceImage, 0, 0, $SourceImage.Width, $SourceImage.Height)
        $path.Dispose()
    } finally {
        $g.Dispose()
    }
    return $layer
}

<#
    One frame of the turn, at 1024, as a full composite of the icon: base art, then the right-page
    layer squashed about the spine (scaleX = cos(pi*t)) with a sin(pi*t) tilt and shade.
#>
function New-FlipFrame {
    param(
        [System.Drawing.Image]$SourceImage,
        [System.Drawing.Image]$PageLayer,
        [double]$Phase
    )

    $frame = New-Object System.Drawing.Bitmap $SourceImage.Width, $SourceImage.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = New-QualityGraphics -Target $frame
    try {
        $g.Clear([System.Drawing.Color]::Transparent)
        $g.DrawImage($SourceImage, 0, 0, $SourceImage.Width, $SourceImage.Height)

        $pi = [Math]::PI
        $scaleX = [Math]::Cos($pi * $Phase)
        $arc = [Math]::Sin($pi * $Phase)          # 0 at both ends, 1 at the vertical sliver
        $tilt = -1 * $TiltDegrees * $arc * [Math]::Sign($scaleX)
        # SQUARED, deliberately. A linear shade still leaves a visible grey ghost on the last frame,
        # where the leaf has all but landed on the left page and any tint reads as a smudge rather
        # than as shadow; squaring concentrates the whole shade around mid-turn (where it is the only
        # thing separating the moving leaf from the page beneath) and lets it fall off to nothing by
        # the landing, which is what makes the loop back to frame 0 invisible.
        $shade = 1.0 - ($ShadeStrength * $arc * $arc)

        $matrix = New-Object System.Drawing.Drawing2D.Matrix
        # Prepend order: the point is translated to the spine origin FIRST, then squashed, then
        # tilted, then translated back.
        $matrix.Translate([single]$SpineX, [single]$SpineY)
        $matrix.Rotate([single]$tilt)
        $matrix.Scale([single]$scaleX, [single]1.0)
        $matrix.Translate([single](-$SpineX), [single](-$SpineY))

        $attrs = New-Object System.Drawing.Imaging.ImageAttributes
        $cm = New-Object System.Drawing.Imaging.ColorMatrix
        $cm.Matrix00 = [single]$shade
        $cm.Matrix11 = [single]$shade
        $cm.Matrix22 = [single]$shade
        $cm.Matrix33 = [single]1.0
        $cm.Matrix44 = [single]1.0
        $attrs.SetColorMatrix($cm)

        $g.Transform = $matrix
        $destRect = New-Object System.Drawing.Rectangle 0, 0, $PageLayer.Width, $PageLayer.Height
        $g.DrawImage($PageLayer, $destRect, 0, 0, $PageLayer.Width, $PageLayer.Height, [System.Drawing.GraphicsUnit]::Pixel, $attrs)
        $g.ResetTransform()

        $attrs.Dispose()
        $matrix.Dispose()
    } finally {
        $g.Dispose()
    }
    return $frame
}

function New-FlipSprite {
    param(
        [System.Drawing.Image]$SourceImage,
        [int]$FrameSize,
        [double]$ScalePercent,
        [string]$OutPath,
        [string]$FramesDir,
        [int]$FramesDirSize
    )

    $pageLayer = New-RightPageLayer -SourceImage $SourceImage -Polygon $RightPagePolygon
    # Frame 0 is the resting icon; the phases add one moving frame each.
    $composites = @($SourceImage)
    foreach ($phase in $FramePhases) {
        $composites += (New-FlipFrame -SourceImage $SourceImage -PageLayer $pageLayer -Phase $phase)
    }

    $count = $composites.Length
    $strip = New-Object System.Drawing.Bitmap ($FrameSize * $count), $FrameSize, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = New-QualityGraphics -Target $strip
    try {
        $g.Clear([System.Drawing.Color]::Transparent)
        for ($i = 0; $i -lt $count; $i++) {
            Add-PaddedIcon -Graphics $g -SourceImage $composites[$i] -OriginX ($i * $FrameSize) -OriginY 0 -CanvasSize $FrameSize -ScalePercent $ScalePercent | Out-Null
        }
    } finally {
        $g.Dispose()
    }

    Ensure-OutDir -OutPath $OutPath
    $strip.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output "Wrote $OutPath ($($strip.Width) x $($strip.Height), $count frames of ${FrameSize}px)"

    if ($FramesDir) {
        Ensure-OutDir -OutPath (Join-Path $FramesDir 'x.png')
        for ($i = 0; $i -lt $count; $i++) {
            $big = New-Object System.Drawing.Bitmap $FramesDirSize, $FramesDirSize, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
            $bg = New-QualityGraphics -Target $big
            $bg.Clear([System.Drawing.Color]::Transparent)
            Add-PaddedIcon -Graphics $bg -SourceImage $composites[$i] -OriginX 0 -OriginY 0 -CanvasSize $FramesDirSize -ScalePercent $ScalePercent | Out-Null
            $bg.Dispose()
            $framePath = Join-Path $FramesDir ("frame-{0}.png" -f $i)
            $big.Save($framePath, [System.Drawing.Imaging.ImageFormat]::Png)
            $big.Dispose()
            Write-Output "  frame $i -> $framePath"
        }
    }

    $strip.Dispose()
    for ($i = 1; $i -lt $count; $i++) { $composites[$i].Dispose() }
    $pageLayer.Dispose()
}

$resolvedSource = (Resolve-Path $SourcePath).Path
Write-Output "Source: $resolvedSource"
$source = [System.Drawing.Bitmap]::FromFile($resolvedSource)
try {
    New-PaddedIcon -SourceImage $source -CanvasSize $HeaderSize -ScalePercent $ScalePercent -OutPath $HeaderOutPath
    New-PaddedIcon -SourceImage $source -CanvasSize $TabSize -ScalePercent $ScalePercent -OutPath $TabOutPath
    New-FlipSprite -SourceImage $source -FrameSize $HeaderSize -ScalePercent $ScalePercent -OutPath $SpriteOutPath -FramesDir $DebugFramesDir -FramesDirSize $DebugFrameSize
} finally {
    $source.Dispose()
}
