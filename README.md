# Contour Dots

A standalone p5.js prototype that turns a photograph into a field of oriented
dots flowing along the contours of its implied 3D form, and exports the result
as a fully editable SVG.

**Three modes read the same photograph and draw three different things from
it.** *Surface* is byte-for-byte v1 — the depth field, the flow field, the
streamline tracing and every decision about where a dot goes and how big it
is. *Edge* draws one line around the subject. *Fingerprint* fills the ground
the subject stands against with ridges. Any combination can be on at once.
See [Three modes](#three-modes).

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
outline as shape 1.

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

## Three modes

Each mode is a separate reading of the picture, so each carries its own
**Threshold** and **Contrast** — and therefore builds its own depth field. The
surface wants a soft, smoothed field it can run contours across; the edge
wants a hard silhouette; the fingerprint wants only the ground behind the
subject. They then share one dot walker, one pair of shapes and one canvas.

### Surface

Everything under [The idea](#the-idea): depth contours wrapping the form,
oriented dots whose size, spacing and colour all come off the depth field.
This is v1, unchanged.

- **Threshold**, **Contrast**, **Depth contrast** — the photograph, before and
  as it becomes a surface.
- **Depth** — displaces each dot along the depth gradient. This is the relief
  that makes the bands bulge towards the viewer rather than read as a flat
  contour map.
- **Smoothing** — turns a noisy photograph into a continuous surface. Contours
  need this.
- **Line density**, **Line spacing** — how many contours and how far apart.
- **Flow strength** (0 = straight lines at the base angle, 1 = pure depth
  contours), **Flow distortion**, **Base angle**, **Flow coherence**.
- **Dot size**, **Size variation**, **Size falloff**, **Dot spacing**,
  **Randomness**, **Node scale**.

That is v1's whole set. An earlier pass held most of it constant to shorten
the panel, which made the tool poorer rather than simpler: flow strength at 0
with distortion at 1 is a different picture, and size variation at 0 is a
different halftone. Every default is still v1's, so the opening render is
v1's.

### Edge

One line, where the subject leaves the background. It rests on the **signed
distance** to the silhouette, positive inside and negative out; its zero level
*is* the edge, so the contour falls out of the field closed and ordered rather
than being chased around a mask pixel by pixel.

Finding that silhouette is the whole problem, and a luminance threshold cannot
do it: on a portrait against a mid-grey wall a threshold selects a *band of
brightness* — the lit face, without the dark hair and without the dark shirt.
So the background is found instead, as the region that touches the frame and
stays the tone the frame is, and everything the flood cannot reach is the
subject, however light or dark. Two conditions hold the flood in: it may not
stray far from the border's own median tone, and it may not cross a cell where
the tone is turning sharply — at the rim of a lit face the face and the wall
are the same grey, and only the steepness tells them apart.

Where it leaks anyway the silhouette can come apart, so a morphological
closing heals thin breaks and the isolation step keeps every substantial part
rather than only the largest: a head cut off its shoulders is still the
subject.

- **Separation** — how far the background may drift from the frame's own tone
  before the subject starts.
- **Dot size**, **Dot spacing**, **Node scale** — larger by default, because
  an edge is a single line and its marks carry it alone.

### Fingerprint

A fingerprint is a set of continuous ridges that never cross, run roughly
parallel, and bend around whatever is in their way — which is the description
of the iso-lines of a scalar field. So the ridges are extracted, not drawn:

```
phi = signedDistance(subject) + swirl * noise
```

The distance term gives clean offsets of the silhouette; the noise term warps
them into whorls, at a frequency low enough that a whole run of neighbouring
ridges bends together instead of breaking into islands. Because they are level
sets of one function, two ridges cannot touch. Only the background side is
drawn — the subject is left to the photograph.

- **Separation** — the same flood that the edge uses, deciding where the
  ridges stop.
- **Ridge spacing**, **Swirl**, **Dot size**, **Dot spacing**, **Node scale**.

## Node + link

The one shape control, shared by all three modes. **Shape 1** lands every Nth
step along a line and **shape 2** fills the run between, so a contour reads as
marked points joined by a dotted rule rather than an undifferentiated stream
of dots. Either falls back to a plain circle until an SVG is loaded into it.

- **Node every** — steps between shape 1. At 1 every dot is shape 1. Shared.
- **Node scale** — how much bigger shape 1 is than shape 2. Per mode.

It is a *labelling* of the walk, never a change to it. Every line still starts
on v1's random phase, the spacing floor still answers about v1's dot, and the
enlarged node is carried separately so it cannot reach back into either. Node
scale changes what a dot looks like and nothing about where it lands.

Uploaded SVGs are kept as a list of parts, each with its own fill, stroke,
stroke-width and fill-rule, rather than merged into one filled path. Merging
loses exactly what makes a shape a shape: a subpath declared `fill-rule="evenodd"`
to punch a hole fills solid, and art defined by stroke with no fill becomes a
blob.

## The guarantee

Surface output is verified against v1 itself — the first commit, served
alongside — by dumping every dot from both builds and comparing field by
field. Ten parameter regimes on two images, checked two ways each:

- at **Node scale 1**, every field is identical, size included;
- at **Node scale 2.2**, every position, rotation and depth is still identical
  and only the marked dots differ in size, by exactly that factor.

Forty checks for forty. Nothing the other two modes do can move a surface dot
either: they never share a depth field, a mask, a flow field or a random
stream.

## The dot primitive

This is deliberately **not** a generic particle system. A dot is a small piece
of oriented geometry that turns as the surface bends, and every shape is stored
once as a path in a unit box:

```js
drawDot(ctx, x, y, size, rotation, type)
```

The two slots hold whatever you upload; each falls back to a circle, which is
rotationally symmetric and takes the fast path. Uploading an SVG reads its
`path` / `circle` / `rect` / `ellipse` / `polygon` / `polyline` / `line`
elements, measures the result with `getBBox()`, and fits it into the unit box
preserving aspect ratio. The canvas renderer and the SVG exporter consume that
one definition, so what you export is exactly what you saw.

## Download

One button, at the end of the panel. It writes a `.zip` that unpacks into a
folder holding two files: the drawing as SVG, and the settings that produced
it as plain text, one per line —

```
["Surface / Line spacing": "9.0"]
["Edge / Separation": "0.12"]
```

Only the settings you can currently see are recorded: the shared block, then
each mode that is switched on.

The SVG is real vector geometry, not a traced bitmap:

- Each shape is emitted **once** into `<defs>`, and each dot is a `<use>`
  carrying its own `translate / rotate / scale`. Swapping that single
  definition restyles every dot in the file at once.
- Circles take a shorter path — a plain `<circle>` — which is smaller and
  friendlier to downstream tools.
- Dots are grouped into colour buckets as `<g fill>` groups rather than
  carrying a fill attribute each.
- The photograph rides along only when **Show image** is on, so the file holds
  exactly what the canvas showed.

Every dot arrives in Illustrator or Figma as an individual editable object.
Export fidelity is verified against the canvas at 99.9% ink overlap within one
pixel; the remainder is antialiasing on dot edges, which the two renderers
shade slightly differently.

## Controls

The panel is a column that owns the window height: the loader at the top, the
download at the bottom, and the controls between them. A mode's own group only
appears while that mode is on, and controls sit two to a row. Click any group
heading to fold it — with all three modes on the full set is taller than a
laptop window, and folding is what keeps the panel the height of the screen
without taking controls away to get there.

**Picture** — Show image (the photograph behind the dots, and in the exported
SVG; off by default, so the opening view is v1's), Background, Far colour,
Near colour.

**Modes** — Surface, Edge, Fingerprint. Independent; any combination.

**Node + link** — Shape 1, Shape 2, Node every.

**Surface / Edge / Fingerprint** — each mode's own group, as above.

Held constant rather than exposed: **Invert depth** and **Colour falloff**,
and — for the edge and fingerprint modes, which sculpt no depth field and run
no flow field — the surface controls that would mean nothing to them. Dot
spacing is floored at a little over one dot diameter, so the largest, densest
dots cannot fuse into a solid line and collapse the halftone into fill.

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
- For **Edge** and **Fingerprint**, Separation is the control that matters:
  raise it until the background is fully claimed, and stop before it starts
  eating into dark hair or a dark shirt.

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
                      region isolation, hole filling, morphological closing
js/field.js           depth field, gradient, flow field
js/streamlines.js     evenly-spaced streamline tracer + spatial hash
js/isolines.js        marching squares: iso-contours as linked polylines
js/edge.js            the silhouette contour
js/fingerprint.js     ridges in the background
js/shapes.js          the dot primitive, drawDot, SVG shape upload
js/dots.js            streamlines -> oriented dots, colour ramp
js/svgexport.js       vector export
js/zip.js             minimal ZIP writer, for the download bundle
js/ui.js              declarative control schema + panel, per-mode parameters
js/app.js             p5 sketch, pipeline orchestration, I/O
vendor/p5.min.js      p5.js 1.9.4
```
