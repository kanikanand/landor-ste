# Contour Dots

A standalone p5.js prototype that turns a photograph into a field of oriented
dots flowing along the contours of its implied 3D form, and exports the result
as a fully editable SVG.

![pipeline: depth field, flow field, streamlines, oriented dots](docs/preview.png)

## Run it

```
open index.html
```

That is the whole setup. There is no build step and no package manager —
p5.js is vendored in `vendor/`, so the page works offline and straight off the
filesystem. To serve it instead:

```
npx http-server -p 8080 .
```

Serving is required for one optional feature: **Estimate depth** loads a depth
model over the network, and browsers refuse module imports on `file://`. Every
other control works offline exactly as before.

Drop an image anywhere on the canvas to load it. Drop an `.svg` to use its
outline as the dot shape.

It opens on a built-in sample so there is something to turn the knobs against
straight away. That sample is deliberately a *shaded render* rather than a
clean depth map — a surface lit from the upper left — because that is what a
real photograph looks like going in, and the pipeline has to recover depth
from luminance either way.

## The idea

The image is not treated as brightness to be halftoned. It is treated as a
**height map**, and everything else is derived from it. There are three fields.

### Field 1 — depth

```
D(x, y)        black = far away,  white = close
```

Depth decides how big each dot is, how densely they pack, and how the surface
reads as form. It does *not* decide where dots exist — the silhouette is field
3's job, and keeping the two apart matters more than it sounds. See below.

### Field 2 — flow

Flow is not authored separately. It is the gradient of depth, turned ninety
degrees so that it runs *along* the iso-depth contours rather than across them:

```
grad D = ( dD/dx ,  dD/dy )
F      = ( -dD/dy ,  dD/dx )
```

Streamlines of `F` are the contour lines, so they wrap around a cheek, a brow
or a knuckle for free. Every dot then takes its orientation from the field it
sits in:

```
rotation = atan2(flow.y, flow.x)
```

### Where depth comes from

Two sources, interchangeable downstream — the gradient, the flow field, the
streamlines and the dots only ever see the finished depth field, so every
control below means the same thing either way.

**Luminance** is the default and needs nothing: it reads the image's own
brightness as height. It costs nothing and works offline, but it is a proxy.
Where a photograph's tones disagree with its geometry — a dark iris on a lit
face, a specular highlight sitting in a crease — the contours follow the tones
and the form goes wrong.

**Estimate depth** replaces that guess with
[Depth Anything V2 (small)](https://huggingface.co/onnx-community/depth-anything-v2-small),
run in the browser through transformers.js — WebGPU where the browser has it,
WebAssembly otherwise. It substitutes for exactly one step, the luminance read
at the top of `buildDepth`, and nothing else in the pipeline changes.

The model outputs *inverse* depth, so larger already means nearer, which is the
convention the field wants. The float tensor is used rather than the 8-bit
preview image the pipeline also returns: the flow field differentiates this
map, and 8-bit quantisation shows up as banding in the gradient.

It is lazy and cached. Nothing is fetched until the control is switched on; the
estimate is then held against that image, so toggling it off and back on is
free and no slider ever waits on the model. The first run downloads weights
(~25 MB quantised on WebAssembly, ~100 MB fp32 on WebGPU) and the browser
caches them; inference is roughly 100–600 ms after that. If the model or the
library cannot be reached, the tool says why, switches the control back off and
carries on with luminance rather than rendering a broken field silently.

**Show depth map** draws field 1 behind the dots, which is the quickest way to
see what the contours are actually following. It is a viewing aid — the SVG
export carries the dots, not the underlay.

To pin a different library build or model, set `window.CD_TRANSFORMERS_URL` or
`window.CD_DEPTH_MODEL` before `js/depthmodel.js` loads.

### Why the flow field is stored as a doubled angle

A contour direction is a **line**, not a vector: `theta` and `theta + PI` mean
the same thing. Averaging raw vectors would cancel them out at every sign flip
and shred the field. So the flow is carried as `(cos 2theta, sin 2theta)`,
which is flip-invariant, smoothed in that form, and halved back on sampling.
That is what lets direction diffuse into the flat, gradient-free regions of a
face instead of dissolving there — and it is why the lines stay continuous.

### Why the lines are evenly spaced

Streamlines are traced with the Jobard & Lefer method: trace a line, then seed
new lines at a fixed perpendicular offset from it, rejecting any seed that
falls too close to a line that already exists. The result is the even woven
banding of the reference, rather than the clumping and crossing you get from
seeding at random. Separation is depth-modulated, so near regions of the
surface carry more lines than far ones.

### Field 3 — region

```
R(x, y) = mask * wipe
```

Where dots are allowed to exist at all. The silhouette the threshold carved,
intersected with an authored area — and the intersection is the whole point. A
wipe on its own is a rectangle laid across the frame, and dots marching off the
subject onto the background read as a filter applied to the picture. Multiplied
by the silhouette they stop at the subject's edge *and* at the wipe, which is
what makes a partial overlay look deliberate.

**The silhouette is read before the relief is smoothed**, and that ordering is
load-bearing. Smoothing depth is what turns a noisy photograph into a
continuous surface, but it also spreads a lit subject out into a dark
background — so a mask taken after it is a dilated one. Measured on a test
frame at the default smoothing: the mask gained 2,351 pixels of ground that
was never part of the subject, and a thin feature six pixels wide (a gun
barrel, a tow hook, a panel edge) went from fully retained at smoothing 4 to
*entirely erased* at smoothing 6. That is what dots floating off the object
look like from the inside.

Taken before the blur, the silhouette is where the picture says it is, and it
no longer moves at all as relief smoothing changes — verified constant from
smoothing 0 through 24. **Silhouette cleanup** is now the only control that
can move it, which is the point: it is one knob, it is labelled, and 0 gives a
razor edge.

If the image carries an **alpha channel**, that is used instead, and nothing
beats it: on the same test frame the alpha silhouette landed within 2 pixels
of the true object and kept both the thin barrel and a black tyre that
luminance drops entirely. A cutout PNG is the single best thing you can feed
this tool.

Region sits on its own pipeline stage, between depth and flow. It costs one
multiply over the analysis grid, so dragging a wipe slider never rebuilds the
depth field — but the tracer and the dots both read it, so the contours retrace
and the lines only exist where the region allows.

## Partial overlay

Dotting part of the subject and leaving the rest of the photograph showing is
just draw order plus field 3. **Show photograph** draws the source image under
the dots; where no dot falls it is never covered, so it stays the original
picture, pixel for pixel. There is no blending involved beyond **Photo fade**,
which sinks the image towards the background colour when you want the dots to
carry more of the picture.

**Partial overlay** turns on the wipe: a soft-edged line with a position, an
angle (the direction the dots run towards — add 180 to swap sides) and a
softness.

**Edge dissolve** is what actually sells the transition. Without it, dots stop
mid-row at a hard coverage threshold and the boundary reads as a cut. With it,
dot size falls off across the feather, and it is remapped against the same
threshold the tracer uses to decide where a line may run — so a dot reaches
zero size exactly where it stops being drawn, rather than vanishing at a third
of full size. Lines and dots share that one number, so they agree about where
the region ends.

## Fill modes

Two ways to fill the region, and they suit different surfaces:

**Contour** (the default) strings dots along the evenly-spaced streamlines.
Anything with curvature — a cheek, a tyre, a shoulder — bands the way the
reference does, because the iso-depth contours of a round thing are rings.

**Grid fill** lays a hexagonally-packed lattice instead, at the base angle.
Broad flat surfaces are where contour bands have little to follow and start to
wander; a lattice reads as a straight halftone there and holds still. Size,
colour and relief still come from depth and rotation still comes from flow, so
the two modes sit in the same picture without disagreeing.

## Depth mapping

Depth is one number, and there are three ways to spend it: the dot's **size**,
its **colour** and its **opacity**. Spending all three at once — which is what
happens when each reads depth at full strength — saturates. Near dots come out
big *and* bright *and* solid, far ones disappear on every axis at the same
rate, and everything in between flattens into the two ends.

Each channel has its own amount, so you can decide what carries the form:

| | |
|---|---|
| **Depth → size** | 0 leaves every dot the same size. The field stays a halftone of discrete points instead of swelling into solid fill where the surface is near. |
| **Depth → colour** | 0 renders the whole field flat in the near colour. |
| **Depth → opacity** | Off by default. It is the channel that most easily turns a halftone into haze, but at low amounts it softens a far edge better than either of the others. |

Size and colour at full strength is the old behaviour, and it is still the
default — the channels reproduce it exactly, not approximately. Turning size
down and leaving colour up is usually the better-looking half of the trade:
uniform dots keep the grain legible and let colour do the modelling, which is
what the halftone references are actually doing.

**Tint from image** switches the colour channel's source from depth to the
picture's own tone. Size then carries the geometry while colour carries the
photograph — two different signals on two different channels, which is the
whole reason to keep them apart.

## The dot primitive

This is deliberately **not** a generic particle system. A dot is a small piece
of oriented geometry that turns as the surface bends, and every shape is stored
once as a path in a unit box:

```js
drawDot(ctx, x, y, size, rotation, type)
```

| `type`     | geometry                                   |
|------------|--------------------------------------------|
| `circle`   | rotationally symmetric; the fast path       |
| `square`   | turns with the contour                      |
| `diamond`  | turns with the contour                      |
| `line`     | a capsule — the most directional of the set |
| `custom`   | any uploaded SVG, normalised to the unit box |

Uploading an SVG flattens its `path` / `circle` / `rect` / `ellipse` /
`polygon` / `polyline` / `line` elements into a single path, measures it with
`getBBox()`, and fits it into the same unit box preserving aspect ratio. The
canvas renderer and the SVG exporter consume that one definition, so what you
export is exactly what you saw.

## SVG export

`Export SVG` writes real vector geometry, not a traced bitmap:

- The shape is emitted **once** into `<defs>`, and each dot is a `<use>`
  carrying its own `translate / rotate / scale`. Swapping that single
  definition restyles every dot in the file at once.
- Circles take a shorter path — a plain `<circle>` — which is smaller and
  friendlier to downstream tools.
- Dots are grouped into colour-and-opacity buckets as `<g fill>` groups rather
  than carrying an attribute pair each. `fill-opacity` is emitted only when a
  group is actually translucent, so an opaque render exports exactly as it did
  before the opacity channel existed.
- The canvas and the exporter call the *same* bucketing function, so the two
  cannot drift apart. Opacity is rounded onto its endpoints rather than binned
  to bucket midpoints — otherwise a fully opaque dot would land on the top
  bucket's centre and every render would be imperceptibly translucent.

Every dot arrives in Illustrator or Figma as an individual editable object.
Export fidelity is verified against the canvas at 99.3–99.8% pixel overlap
across all shape types; the remainder is antialiasing on dot edges.

`Export PNG` writes the canvas as-is.

## Controls

**Depth source** — Estimate depth (Depth Anything V2 instead of luminance),
Show depth map (field 1 as a greyscale underlay).

**Silhouette** — Use image alpha, Silhouette cut, Silhouette cleanup.

**Overlay** — Show photograph, Photo fade, Partial overlay (the wipe), Wipe
position / angle / softness, Edge dissolve.

**Image** — Depth floor (where the relief starts; no longer carves the
silhouette), Contrast, Invert depth (for a subject lit dark-on-light).

**Depth** — Depth exaggeration (displaces each dot along the depth gradient;
this is the relief that makes the bands bulge towards the viewer rather than
read as a flat contour map), Depth contrast, Depth smoothing (turns a noisy
photograph into a continuous surface — contours need this).

**Contours** — Line density, Line spacing, Flow strength (0 = straight lines
at the base angle, 1 = pure depth contours), Flow distortion, Base angle,
Flow coherence.

**Dots** — Grid fill, Shape, Dot size, Size variation, Size falloff, Dot
spacing, Randomness.

**Depth mapping** — Depth → size, Depth → colour, Depth → opacity, Tint from
image.

**Colour** — Background, Far colour, Near colour, Colour falloff.

Dot spacing is floored at a little over one dot diameter, so the largest,
densest dots cannot fuse into a solid line and collapse the halftone into fill.

## Getting a good result from a photograph

The pipeline reads luminance as depth, so it rewards images that are already
lit like a depth map: a single strong light, a dark background, and the subject
falling off into shadow at its edges. Studio portraits and product shots on
black work best.

- Set the **silhouette** first, and independently: **Silhouette cut** so the
  background drops out, **Silhouette cleanup** as low as the edge tolerates.
  Nothing you do afterwards will move it.
- Then **Depth smoothing** — raise it until the contours stop breaking into
  small closed loops and start reading as bands. It is free now: it costs
  structure but not silhouette.
- **Flow strength** below about 0.5 is where the piece stops being a contour
  map and starts being a striped halftone; both are useful.
- If the subject is dark against a light ground, turn on **Invert depth**
  first — nothing else will behave until the near/far sense is right.

### When the dots wander instead of tracking the subject

Big lazy loops that ignore panel lines and wheel arches mean the structure the
contours follow has been smoothed away. Gradient energy — the signal the flow
field is built from — measures 100% unsmoothed, 66% at smoothing 4 and 55% at
smoothing 10. For a clean render rather than a noisy photograph:

| control | value | why |
|---|---|---|
| Silhouette cleanup | 0 | a render has no edge noise to settle |
| Depth smoothing | 2–4 | keeps panel lines in the gradient |
| Flow coherence | 1–3 | diffuses direction without smearing it |
| Depth exaggeration | 0 | stops dots sliding off their own contour |
| Randomness | 0–0.05 | precision, not texture |
| Dot size / spacing | small and tight | detail needs somewhere to land |

Turning **Estimate depth** on matters most here. A render's tyres and shadowed
recesses are near-black, and luminance reads them as background at any
threshold — so the wheels, which carry the best structure in a vehicle shot,
come out empty.

Where a photograph's brightness genuinely disagrees with its geometry — a dark
iris on a lit face, a specular highlight in a crease — luminance depth will
follow the brightness, because brightness is then the only depth signal
available. Turn on **Estimate depth** and that stops being true: the model
reads the geometry instead, and the controls behave the same way. Expect to
drop **Depth smoothing** a long way afterwards — an estimated map arrives
already continuous, and the smoothing that rescues a noisy photograph will
flatten real form out of it.

## Performance

The pipeline is staged, and each control dirties only its own stage and
everything downstream of it:

```
depth  ->  region  ->  flow  ->  lines  ->  dots  ->  draw
```

Moving a dot slider never re-traces the contours; changing a colour only
redraws. Depth estimation sits upstream of the whole chain and runs once per
image, so it never enters this budget. While a slider is moving, a reduced-quality draft renders at ~50 ms
and a full-quality pass follows once you stop. Analysis runs on a 420 px grid
regardless of source resolution. Typical full render is 40–200 ms; the densest
possible settings (~100k dots) take about 3 s.

## Files

```
index.html            markup + script order
css/style.css         tool chrome
js/core.js            Field container (bilinear sampling, separable blur), resample, math
js/field.js           depth field, gradient, flow field, region field
js/streamlines.js     evenly-spaced streamline tracer + spatial hash
js/shapes.js          the dot primitive, drawDot, SVG shape upload
js/dots.js            contour + grid fills, edge dissolve, colour ramp
js/svgexport.js       vector export
js/depthmodel.js      Depth Anything V2 in the browser (transformers.js)
js/ui.js              declarative control schema + panel
js/app.js             p5 sketch, pipeline orchestration, I/O
vendor/p5.min.js      p5.js 1.9.4
```
