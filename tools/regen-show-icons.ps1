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
    horizontal strip of 7 frames in which the book's RIGHT PAGE turns over onto the left. Frame 0 is
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
    The moving page is darkened at mid-turn (a turning leaf catches less light) and the page it lifts
    OFF is darkened under it (see New-FlipFrame) - between them those two shades are the whole depth
    cue, since an affine transform gives no curl and no foreshortening to supply one.

    A NOTE ON DIRECTION, unresolved and worth the owner's eye: the leaf turns right-to-left, i.e. the
    way a LATIN book is read. PageDraft's default language is Hebrew, whose books turn the other way.
    Mirroring it is a one-line change (negate the phase's sign about the spine) but it would then be
    wrong for the English UI, and the icon is one static asset serving both, so this is a choice about
    the artwork rather than a bug to fix here.

    THE SCALE, RE-DERIVED BY MEASUREMENT (f2b, 2026-08-18). The owner's verdict on the shipped icon was
    "the icon today is too small". The cause was PADDING APPLIED TWICE, and it is worth writing down
    because nothing about it is visible from the CSS:

        the 1024x1024 source art fills only 716x677 of its own canvas (70% x 66%; measured on the
        alpha channel), and f1 then drew that at 76% of the target canvas

    so the face the user actually saw was 0.76 x 0.70 = 53% of the icon box wide - a 32px launcher icon
    carrying a 17px face inside a 48px button, i.e. the button was 2.8x the artwork. f1's 76% was chosen
    by eye against the risk that the CSS's inscribed-circle mask clips the head, and that risk is real
    but it is also MEASURABLE: the farthest opaque pixel in the source sits 365.3px from the canvas
    centre, against an inscribed radius of 512, so the art clears the circle at any scale up to 140.1%.
    76% was 1.8x more conservative than it needed to be.

    112% is the shipped value: the art then reaches 80% of the mask's radius, which leaves a fifth of
    the radius as visible margin inside the icon's own circle plus the launcher's 4px surface ring. Do
    not raise this past ~130% without re-measuring - the bound above is for THIS artwork, and a source
    re-export that moves the book or the head moves the bound with it. The measurement is a short alpha
    scan; re-run it rather than re-guessing.

    Usage:
        pwsh ./tools/regen-show-icons.ps1
        pwsh ./tools/regen-show-icons.ps1 -ScalePercent 95    # if 112 ever crowds a mount
        pwsh ./tools/regen-show-icons.ps1 -DebugFramesDir C:\some\dir   # also dump 256px frames

    Sizes (f2b raised all three, because the launcher mount went 32px -> 48px):
        show-header.png       144x144  (dock launcher, drawn at 48px; product-chat empty state at 56px;
                                        product-chat speaker byline at 20px)
        show-tab.png          64x64    (dock assistant tab, drawn at 20px)
        show-flip-sprite.png  1008x144 (7 x 144, the launcher's flip overlay)

    Every derived size is at least 3x its largest mount, which is what keeps all four crisp on a 3x
    display. Change a mount size in the CSS and the matching number here has to move with it.
#>

[CmdletBinding()]
param(
    [string]$SourcePath,
    [string]$HeaderOutPath,
    [string]$TabOutPath,
    [string]$SpriteOutPath,
    [int]$HeaderSize = 144,
    [int]$TabSize = 64,
    [double]$ScalePercent = 112,

    # Where in the 1024x1024 source the book's RIGHT PAGE lives, as a polygon: spine-top,
    # outer-top, outer-bottom, spine-bottom. Read off a 3x zoom of the source with a 20px grid on
    # 2026-08-18. Deliberately stops ABOVE the navy band that outlines the book's lower edge, so the
    # outline stays put and only the cream leaf moves.
    [int[]]$RightPagePolygon = @(512, 342,  765, 297,  778, 402,  512, 428),

    # The spine, i.e. the axis the page turns about.
    [int]$SpineX = 512,
    [int]$SpineY = 392,

    # The turn, sampled at these phases of a half rotation (t in 0..1, scaleX = cos(pi*t)). Frame 0 is
    # the resting icon and carries no moving page at all. Six moving frames rather than f2's five: the
    # extra one buys an early "the leaf has lifted but is still wide" pose, which is what tells the eye
    # a PAGE is moving before the leaf gets too narrow to have a shape.
    # The last phase is 0.95 rather than f2's 0.93 on purpose: at 0.95 the leaf has all but landed
    # (scaleX = -0.988, tilt 4.7 degrees at the shipped TiltDegrees), so the frame the cycle holds
    # before jumping home to frame 0 is nearly frame 0 already and the loop has almost nothing to
    # snap over. Raise TiltDegrees and this number is the one that has to be re-checked with it.
    [double[]]$FramePhases = @(0.14, 0.30, 0.45, 0.60, 0.78, 0.95),

    # Peak tilt of the moving leaf, degrees, scaled by sin(pi*t) so it is 0 at rest and at landing.
    # 30, up from f2's 7. This is the parameter that carries the whole gesture, and the reason is
    # geometric rather than aesthetic: the leaf's SQUASH is invisible at icon size (the right page is
    # about 11px wide at a 48px mount, so a whole frame of the turn moves its outer edge two pixels),
    # but the tilt lifts the leaf's far corner OUT of the book's silhouette and into the flat teal
    # background above it, where a two-pixel shape has nothing to hide against. Frames 1, 2 and 5 all
    # read as "a sheet is up in the air" only because of this term; at f2's 7 degrees the lift was
    # under a pixel and the frames were indistinguishable from rest. Compared 22 / 30 / 38 side by
    # side at the real 48px (see the zoom sheets): 22 lifts too little to separate from the book's own
    # top edge, and by 38 the leaf arcs so far it stops reading as attached to the spine at all and
    # starts to look like a wing. 30 is the middle that was actually looked at, not a split difference.
    [double]$TiltDegrees = 30,

    # Peak darkening of the moving leaf (0 = none, 1 = black), applied as sin^2 so it is 0 at both ends.
    # 0.30, and this is DOWN from the 0.48 the first cut of f2b tried. Turning the leaf darker is the
    # obvious move and it is the wrong one: at 0.48 the leaf renders as a grey-brown wedge and the
    # gesture reads as a SHADOW sweeping across the icon rather than as a page turning, because paper
    # is the one thing a dark shape cannot be. What separates the leaf from its background is the
    # darkened reveal below (UnderShadeStrength), not the leaf's own tone, so the leaf only needs
    # enough shade to have an edge. Judged at 48px against 0.16 / 0.24 / 0.30 / 0.36 / 0.48.
    [double]$ShadeStrength = 0.30,

    # Peak darkening of the page REVEALED under the turning leaf, at the moment the leaf lifts. Decays
    # linearly to nothing by the end of the turn: the leaf that was casting the shadow has gone.
    # 0.20, also down from the first cut's 0.36. This layer dims the whole page region uniformly rather
    # than as a gradient hugging the leaf's edge (System.Drawing gives a colour matrix, not a soft
    # shadow), so past about 0.25 it stops reading as a shadow and starts reading as the right page
    # changing colour - which is a different, wronger animation. Kept just deep enough to hold an edge.
    [double]$UnderShadeStrength = 0.20,

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
    Build the 5x4 colour matrix that multiplies RGB by $Shade and leaves alpha alone.
#>
function New-ShadeAttributes {
    param([double]$Shade)

    $attrs = New-Object System.Drawing.Imaging.ImageAttributes
    $cm = New-Object System.Drawing.Imaging.ColorMatrix
    $cm.Matrix00 = [single]$Shade
    $cm.Matrix11 = [single]$Shade
    $cm.Matrix22 = [single]$Shade
    $cm.Matrix33 = [single]1.0
    $cm.Matrix44 = [single]1.0
    $attrs.SetColorMatrix($cm)
    return $attrs
}

<#
    One frame of the turn, at 1024, as a full composite of the icon, in three layers:

      1. the base art,
      2. the page REVEALED beneath the turning leaf - the same page layer drawn in place and darkened,
      3. the leaf itself, squashed about the spine (scaleX = cos(pi*t)) with a sin(pi*t) tilt and shade.

    LAYER 2 IS WHAT MAKES THIS READ AS A PAGE TURN (f2b), and its absence is why the first cut did not.
    The base art keeps its right page in every frame, so a leaf drawn on top of it was only ever a
    shape sweeping ACROSS a book whose right page never left - at 32px that was a shimmer near the
    spine. Redrawing the page region darkened is what gives the leaf somewhere to lift OFF: the eye
    sees a lit page go dim under a moving edge and reads a sheet coming up. The darkening decays to
    nothing by the end of the turn, so the last frame's right page is already back at full brightness
    and the loop home to frame 0 has nothing left to snap.

    The artwork has no second page drawn under the first - it is one flat illustration - so "the page
    beneath" is the same pixels dimmed rather than different pixels. Under a stylized flat icon at
    48px that is indistinguishable from a real one, and it costs no new art.
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

        # The revealed page. Deepest as the leaf lifts (it is what casts the shadow), gone by landing.
        $underShade = 1.0 - ($UnderShadeStrength * (1.0 - $Phase))
        $underAttrs = New-ShadeAttributes -Shade $underShade
        $pageRect = New-Object System.Drawing.Rectangle 0, 0, $PageLayer.Width, $PageLayer.Height
        $g.DrawImage($PageLayer, $pageRect, 0, 0, $PageLayer.Width, $PageLayer.Height, [System.Drawing.GraphicsUnit]::Pixel, $underAttrs)
        $underAttrs.Dispose()

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

        $attrs = New-ShadeAttributes -Shade $shade

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
