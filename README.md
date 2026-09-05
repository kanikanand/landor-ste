# Contour Dots

A standalone p5.js prototype that turns a photograph into a field of oriented
dots flowing along the contours of its implied 3D form, and exports the result
as a fully editable SVG.

**This is v1 with two things added and nothing changed.** The surface renderer
below — the depth field, the flow field, the streamline tracing and every
decision about where a dot goes and how big it is — is byte-for-byte v1. Added
alongside it: an **edge renderer** that traces the subject's outline, and a
**node + link** dot mode that alternates two uploaded shapes along a line. See
[What v5 adds](#what-v5-adds).

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

Drop an image anywhere on the canvas to load it. Drop an `.svg` to use its
outline as the dot shape.

It opens on a built-in sample so there is something to turn the knobs against
straight away. That sample is deliberately a *shaded render* rather than a
clean depth map — a surface lit from the upper left — because that is what a
real photograph looks like going in, and the pipeline has to recover depth
from luminance either way.

## The idea

The image is not treated as brightness to be halftoned. It is treated as a
**height map**, and everything else is derived from it. There are two fields.

### Field 1 — depth

```
D(x, y)        black = far away,  white = close
```

Depth decides four things: where dots exist at all, how big each one is, how
densely they pack, and how the surface reads as form. Everything below the
threshold is negative space — genuine background, not a dark dot.

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

## What v5 adds

### Edge renderer

The **Mode** switch chooses *Surface* (everything below, unchanged), *Edge*, or
*Both* — which generates each and draws them together.

Edge mode rests on the **signed distance** to the subject's silhouette,
positive inside and negative out in the background. Its zero level *is* the
edge and every other level is a parallel offset, so one contour and eight
stepping outward are the same operation at different levels. Contours are
extracted exactly, by marching squares, rather than approximated.

- **Number of lines** — how many contours step away from the edge.
- **Spread** — which side of the edge they step towards.
- **Shading** — how much tonality thins the stack. At 0 every band is drawn
  everywhere, so the contours are pure geometric offsets of the silhouette. At
  1 the darks keep the full stack and the lights fall back to the outline.
- **Largest region only** — traces one subject and fills its enclosed holes,
  so an eye socket dipping past the threshold does not grow its own contours.

The silhouette it traces is derived from the threshold mask but held
separately: isolated, hole-filled, and feathered a little harder for tracing.
The surface renderer keeps using the mask exactly as v1 built it, which is why
turning any of this on cannot move a single surface dot.

The tonality that drives Shading is taken from the raw luminance and is never
inverted — **Invert depth** says which side of the threshold is the subject,
which is a different question from which parts of the picture are dark.

### Node + link

A shape mode alongside the built-ins and the single Custom slot. It adds two
more slots: **shape 1** lands every Nth step along a line and **shape 2** fills
the run between, so a contour reads as marked points joined by a dotted rule
rather than an undifferentiated stream of dots. Either falls back to a plain
circle until an SVG is loaded into it.

- **Node every** — steps between shape 1. At 1 every dot is shape 1.
- **Node scale** — how much bigger shape 1 is than shape 2.

Each line starts on a node rather than a random phase, so an open contour
terminates with one instead of cutting off mid-run, and links are suppressed
within about a node radius of the node just placed.

Uploaded SVGs are now kept as a list of parts, each with its own fill, stroke,
stroke-width and fill-rule, rather than merged into one filled path. Merging
loses exactly what makes a shape a shape: a subpath declared `fill-rule="evenodd"`
to punch a hole fills solid, and art defined by stroke with no fill becomes a
blob. A built-in is a single filled part, so this is identical to v1 for every
shape that ships with the tool.

### The guarantee

Surface output is verified against v1 by dumping every dot from both builds and
comparing field by field — position, size, rotation and depth. Across eight
parameter regimes (defaults, heavy smoothing, dense, jittered, blended flow,
sparse, a non-circle shape, inverted), roughly 63,000 dots, every value is
identical. In Both mode the surface layer still yields v1's exact contour count.

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
- Dots are grouped into colour buckets as `<g fill>` groups rather than
  carrying a fill attribute each.

Every dot arrives in Illustrator or Figma as an individual editable object.
Export fidelity is verified against the canvas at 99.3–99.8% pixel overlap
across all shape types; the remainder is antialiasing on dot edges.

`Export PNG` writes the canvas as-is.

## Controls

**Image** — Threshold (carves the negative space), Contrast, Invert depth
(for a subject lit dark-on-light).

**Depth** — Depth exaggeration (displaces each dot along the depth gradient;
this is the relief that makes the bands bulge towards the viewer rather than
read as a flat contour map), Depth contrast, Depth smoothing (turns a noisy
photograph into a continuous surface — contours need this).

**Render** — Mode: Surface, Edge or Both. Controls belonging to one renderer
are hidden in the other.

**Contours (Surface)** — Line density, Line spacing, Flow strength (0 =
straight lines at the base angle, 1 = pure depth contours), Flow distortion,
Base angle, Flow coherence.

**Contours (Edge)** — Number of lines, Line spacing, Spread, Shading, Shading
falloff, Largest region only.

**Dots** — Shape (including Node + link with its two slots), Node every, Node
scale, Dot size, Size variation, Size falloff, Dot spacing, Randomness.

**Colour** — Background, Far colour, Near colour, Colour falloff.

Dot spacing is floored at a little over one dot diameter, so the largest,
densest dots cannot fuse into a solid line and collapse the halftone into fill.

## Getting a good result from a photograph

The pipeline reads luminance as depth, so it rewards images that are already
lit like a depth map: a single strong light, a dark background, and the subject
falling off into shadow at its edges. Studio portraits and product shots on
black work best.

- Start with **Depth smoothing** — raise it until the contours stop breaking
  into small closed loops and start reading as bands.
- Then set **Threshold** so the background is fully black and the subject's
  silhouette is where you want it.
- **Flow strength** below about 0.5 is where the piece stops being a contour
  map and starts being a striped halftone; both are useful.
- If the subject is dark against a light ground, turn on **Invert depth**
  first — nothing else will behave until the near/far sense is right.

Where a photograph's brightness genuinely disagrees with its geometry — a dark
iris on a lit face, a specular highlight in a crease — the contours will follow
the brightness, because brightness is the only depth signal available. Feeding
the tool an actual depth map (from a phone's portrait-mode depth channel, or a
monocular depth estimator) sidesteps that entirely, and the controls behave the
same way.

## Performance

The pipeline is staged, and each control dirties only its own stage and
everything downstream of it:

```
depth  ->  flow  ->  lines  ->  dots  ->  draw
```

Moving a dot slider never re-traces the contours; changing a colour only
redraws. While a slider is moving, a reduced-quality draft renders at ~50 ms
and a full-quality pass follows once you stop. Analysis runs on a 420 px grid
regardless of source resolution. Typical full render is 40–200 ms; the densest
possible settings (~100k dots) take about 3 s.

## Files

```
index.html            markup + script order
css/style.css         tool chrome
js/core.js            Field container (bilinear sampling, separable blur),
                      exact Euclidean distance transform, signed distance,
                      connected-region isolation and hole filling, math
js/field.js           depth field, gradient, flow field
js/streamlines.js     evenly-spaced streamline tracer + spatial hash
js/isolines.js        marching squares: iso-contours as linked polylines
js/edge.js            signed-distance bands and the tone gate
js/shapes.js          the dot primitive, drawDot, SVG shape upload
js/dots.js            streamlines -> oriented dots, colour ramp
js/svgexport.js       vector export
js/ui.js              declarative control schema + panel
js/app.js             p5 sketch, pipeline orchestration, I/O
vendor/p5.min.js      p5.js 1.9.4
```
