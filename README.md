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

## The panel

Four questions, in the order you actually answer them:

| section | what it settles |
|---|---|
| **Image** | what the tool reads in your picture |
| **Place** | which part of the picture gets dots |
| **Pattern** | how the dots are drawn |
| **Look** | colour, and what changes from near to far |

Each section shows the three to five controls that matter and folds the rest
behind a **More** button belonging to that section. Fourteen or fifteen
controls up front depending on mode, the rest folded — and the detail sits with the thing it details, so
wondering about scatter while you are in Pattern is one click, not a hunt
through one long pile at the bottom.

Everything is named for what you will see change, in one or two words. A
control called "Flow coherence" is only honest if you already know there is a
flow field; if you do not, it is a dice roll. So it is "Form reach",
"Despeckle", "Relief", "Edge fade", "Grid ↔ form".

The whole panel measures **900px**, so it fits a laptop window without
scrolling. No control carries its description in the layout: printed under
every row it doubled the height, and revealed on hover it was worse — the
panel shifted under the cursor every time a control was touched, so reaching
for a slider moved the row you were reaching for. The text is each row's
tooltip instead, which costs no space and never reflows. Hovering and focusing
all forty-nine controls moves zero rows; so does switching mode.

The order is load-bearing. **Image** comes first because every mode builds on
it: the modes decide where dots go, the image settings decide what those dots
are reading. Switching mode never touches the image settings and re-reading an
image never touches the mode — the two sets share no parameter, and there is a
test that says so.

## Download

There is one button, and it is the only export. Reseed and Reset are gone:
reseeding only re-rolled the random scatter, which is invisible unless Scatter
is turned well up, and Reset was a worse version of reloading the page.

One button, one folder: the SVG and a plain-text record of every setting that
produced it, written in the same words the panel uses, plus what auto-adjust
read off the picture. Browsers cannot write a directory, so the folder is a
zip — stored, not compressed, because an SVG and a page of text are not worth
a deflate implementation. The record is generated from the schema, so it
cannot drift out of date as controls are renamed.

## Grid, without a grid mode

There is no grid mode. **Grid ↔ follows the form** at 0 runs the rows straight
and the dots read as a lattice; at 1 they wrap around the subject. One slider,
and every value between is usable.

A separate lattice fill existed and has been taken out of the panel: it was a
fourth thing to learn that produced a stiffer result than turning this slider
down, because it threw away any knowledge of where the subject was. It is
still there under Pattern → More for the cases where a truly flat lattice is
wanted.

## Four layers, not one list

The earlier modes mixed three decisions into one list: *full* described
placement, *edge* described a behaviour, *background* described placement
again. That does not scale — the moment a new behaviour or placement appears,
every combination has to be re-enumerated.

Four independent layers instead:

| layer | question | options |
|---|---|---|
| **Content** | what is being communicated | Concepts · Products · People |
| **Behaviour** | what the field does | Form · Trace · Gather |
| **Placement** | where it lives | Behind · Within · Around · whole frame |
| **Intensity** | how expressive it is | Quiet · Supporting · Hero |

One rule holds it together, and every default is that sentence turned into
numbers: **Concepts — the dots create. Products — the dots reveal. People —
the dots support.**

Behaviour decides which *surface* the dots read, which is the honest
difference between the three: **Form** follows the subject's own shape,
**Trace** follows the line where it ends, **Gather** follows distance from a
focal point. Placement then decides which side of the outline they sit.

## Six approved presets

Presets rather than guidelines, because a guideline gets interpreted and a
preset gets used. Each names all four layers; the numbers come from the
layers, so changing a behaviour reaches every preset that uses it.

| preset | region | field read | measured coverage |
|---|---|---|---|
| Concept · Hero | whole frame | generated | 62% |
| Concept · Quiet | whole frame | generated | 44% |
| People · Environmental | behind | focal | 53% |
| People · Integrated | within | the picture | 19% |
| Product · Showcase | behind | focal | 32% |
| Product · Detail | around | distance | 2.3% |

## Intensity, and one parameter leading

Intensity is deliberately **one** control moving density, scale and coverage
together. Exposing all three invites all three to be pushed at once, which is
how a system stops looking engineered.

**Led by** is the other half of that restraint: whichever dimension is doing
the talking gets its full range, and the other two are damped towards the
middle so they cannot compete with it. Dot scale is clamped to a narrow band —
one circular primitive with a limited size range is the first line of the
visual DNA, and a slider that can reach a blob has already broken it.

## Concepts: the field forms the subject

For Concepts the dots are not describing something else; they *are* the image.
That is a primary expression, not what happens when a photograph is missing,
so it has its own construction rather than the photo pipeline run on an empty
frame — a height field built from a focal point, a direction and a star
geometry, handed to exactly the same contour pipeline a photograph uses.

**Expand ↔ converge** is one axis through three readings, because they are
three points on one line rather than three settings: expansion at 0, alignment
in the middle, convergence at 1. Verified — the centre of the field reads 0.14
under expansion, 0.76 under alignment, 1.00 under convergence.

**On the star.** The organising geometry is a *parametric N-pointed star*,
because the real mark's construction is not in this repository. It is a
stand-in with the right behaviour — an N-fold symmetry the field resolves
towards — and **it should be replaced by the actual logo geometry before this
is used for anything real**. It is an organising influence and a resolution
point, never a shape scattered through the pattern.

## Protecting what carries the meaning

Two reasons to hold an area clear, kept apart because they are not the same
thing. **Protect subject** is about the subject: eyes, mouth and hands on a
person; a material finish, an interface or a label on a product. Those carry
the meaning, and a field laid over them reads as damage. It is placed
automatically at the horizontal centre of mass of the top fifth of the
silhouette — a heuristic, not a face detector, but a face is reliably at the
top of a person and near their centre of mass there, and being roughly right
automatically beats being exactly right only when someone remembers.

**Copy space** is about the page: somewhere for the headline that was designed
in rather than found by cropping afterwards.

## Palette

Approved red and neutral pairs, checked for contrast, in place of two free
colour wells. A colour picker is that decision handed back to whoever is in a
hurry.

## A mode is not a reset

Switching mode used to write the whole preset over your settings, so tuning
the dots and then changing where they go threw the tuning away. A preset is a
starting point for a control nobody has touched, not an instruction to discard
a decision someone has already made.

The panel now records what you move. Switching mode overwrites only the
settings you have never touched, plus the three that *are* the mode — which
region, whether depth comes from the picture or from distance to the outline,
and the band width. Measured: set Size to 6.5 and Spacing to 12, switch mode,
and both are still 6.5 and 12.

## Only what the mode can act on

The three modes do not need the same controls, and showing the ones they
cannot use is worse than hiding them: it invites a change that has no effect,
and quietly teaches that the panel is not to be trusted.

**Full** covers the whole frame, so it has no outside to find and needs no
subject separation at all. What it does need is the tonal reading, because
that is where its depth comes from.

**Background** and **Edge** are the mirror image. Their only job on the image
is the line between subject and ground, and their depth is distance to that
outline, not the picture's tones — so brightness, contrast, depth range, the
shadow floor and the relief controls do nothing in them whatsoever.

So the panel shows one set or the other:

| | Full | Background · Edge |
|---|---|---|
| Image | Brightness, Contrast, and the depth reading behind More | **Subject from**, and how it is refined |
| everything else | the same | the same |

Fifteen controls in Full, fourteen in Background and Edge, and every one of
them does something. A section with nothing left to show hides, and so does a
**More** button with nothing behind it. The settings file records only what
applied, for the same reason.

**Nodes.** Dot shape is gone — it is always a circle. In its place, **Join
into nodes** draws each row as a line through its own dots, so the field reads
as a network rather than as loose points. It exports as one polyline per row,
editable as a path.

**Finer detail.** Everything is read on an analysis grid, and that grid was the
ceiling on how small a thing could be detected at all. It was 420px, chosen
when the pipeline was far slower than it is now, and it was quietly discarding
the small stuff. At 640px the same plate yields 220 contours instead of 135
and twice the dots, for 1.8× the time — a full render is still about a
quarter of a second. 900px was tried and rejected: four times the cost for
proportionally less gain.

**One way to say one thing.** Row spacing now follows dot spacing rather than
being its own control — two numbers for one idea meant tightening the dots
left the rows where they were, and the field went stripy instead of finer.
Flow spread, Wobble and Scatter-along went the same way: each was a second
knob on something already exposed, and they are now fixed at the values that
were worth having.

Nine controls went entirely rather than being hidden — Soften edge, Size falloff, Row
density, Flat lattice, Colour falloff, Dot shape, Row spacing, Flow spread and
Wobble. Each either duplicated a neighbour or was a second-order curve on a
control that already had a strength.

Three controls depend on something outside the panel — the image carrying its
own cut-out, or being able to fetch a model. When that thing is absent they
now grey out and say why, instead of looking live and doing nothing.

## Modes, and why there are only three

The obvious reading of "interaction with imagery", "background to imagery",
"revealing imagery", "gridded versus fluid" and "with and without imagery" is
five modes. That is the wrong shape. They are not five points on one axis —
they are one axis and three switches:

| decision | options | what it settles |
|---|---|---|
| **Mode** | Full · Background · Edge | which region of the picture gets dots |
| **Photograph** | on · off | whether the picture is present at all |
| **Reveal** | on · off + position | the hand-over between picture and dots |

Three modes by two photograph states by two reveal states is twelve looks out
of three decisions, and every combination means something: a surface treatment
can reveal or not, any of them can drop the photograph. Enumerated as presets
that would have been twelve buttons, each going stale the moment a new region
source is added.

The three differ in **which region gets dots**, and the difference has to be
visible at a glance or they are one mode wearing three names. Measured in the
browser on one plate:

| | region | share of the frame | dots on the subject |
|---|---|---|---|
| **Full** | all of it, varying with light and depth | 100% | proportional |
| **Background** | the ground only | 54% | **0%** |
| **Edge** | the outline between them | 4.2% | straddles it |

Background dilates the silhouette slightly before subtracting it, so the dots
stop short of the subject instead of crowding its edge. Reading `1 - mask`
directly let dots sit anywhere the outline was merely soft, which on an
uncertain outline means dots scattered across the subject.

Background and Edge do not read the picture's tones for depth. They read
**distance from the outline**, because contours of a distance field are offset
curves of the silhouette — which is what makes the rings belong to the subject
rather than halftone whatever is behind it. **Grid ↔ form** still applies:
Background at 1 gives the fingerprint rings, at 0 a straight grid.

## Telling the subject from the background

This is the part that decides whether the modes mean anything, and a
brightness cutoff cannot do it on a real photograph. It draws one line through
the tones and calls one side "subject", which only works if the subject is
entirely brighter, or entirely darker, than the ground. A portrait against a
mid-grey wall is neither: the lit cheek is brighter than the wall and the hair
and the shirt are darker, so the subject sits on **both sides** of it.

Measured on exactly that plate, across every cutoff available:

| cutoff | agreement with the true subject |
|---|---|
| the best value anywhere (0.02) | **42%**, and only by swallowing the whole background |
| low enough to exclude the background (0.36) | misses **93% of the person** |
| separating on **depth** instead | **100%** |
| separating on a **background plate** | **88%**, with **0%** background bleed |

There is no good cutoff. That is why Edge was tracing the light-and-shadow
line across a face rather than the outline of the person, and why Background
was dotting the face: the outline it was given was not the person's.

**Subject from** picks the reading, and Auto takes the best one available:

- **Plate** — a second exposure of the empty set. The subject is wherever the
  two frames differ, measured in RGB rather than luminance so a subject that
  differs only in hue still separates. Exact, free, offline, and the right
  answer whenever the set can be photographed on its own. Robust to noise
  between the two frames: still 76% agreement with heavy grain on both.
- **Depth** — the subject is the near part. Works from one frame and ignores
  tone entirely. Needs the depth model. The near/far split is found by Otsu on
  the depth histogram rather than asked for, because a depth of 0.43 is not a
  number anyone can judge.
- **Cut out** — a matting model run in the page. The same family
  [rembg](https://github.com/danielgatis/rembg) uses on the desktop, so a
  transparent PNG made there and a matte made here are interchangeable; this
  route only exists so the Python step is optional. Unlike brightness it does
  not care that the lit cheek is brighter than the wall and the hair is
  darker, because it was trained to find people rather than to find a tone.
- **Alpha** — the file already carries its outline. **This is the path to use
  if you already run rembg**, or a plugin that wraps it: export a transparent
  PNG, drop it in, and Auto picks the alpha up with no settings at all.
  Verified end to end — an rembg-shaped cutout reads as `alpha`, gives the
  true subject area, and Background then puts 0% of its dots on the subject.
- **Bright** — the fallback, kept because it needs nothing.

The status bar names which one produced the outline, and says *(unreliable)*
when the result is nearly all subject or nearly none — a matte like that is
the tool failing quietly, and the modes should not be allowed to draw
something meaningless from it.

**Fill holes** closes gaps inside the subject where it happens to match the
ground. It floods the background inwards from the frame edge and fills
whatever the outside cannot reach, so it works at any size and cannot move the
outline by construction. Morphology was the wrong tool and was tried first: a
blur-based close only reaches a hole's rim, returning a sixty-pixel hole 13%
filled at radius twelve, and radii large enough to reach the middle round off
genuine concavities. The flood recovers 100% of an enclosed hole and moves the
outline by zero pixels.

## Auto-tune: the controls that have a right answer

Roughly a third of the panel was never aesthetic. Polarity, where the
background ends, how far the subject's tones actually span, how much of the
fine detail is noise rather than form — those have correct answers for a given
plate, and the answers are recoverable from the plate. Leaving them as sliders
meant every new image began by rediscovering them, and getting one wrong made
every downstream control misbehave.

Auto reads, in one pass: the border against the frame centre for **polarity**;
the border's lower quartile and spread for **where the background ends**, with
Otsu's threshold as a cap rather than a floor; the subject's own 2nd and 98th percentiles for **exposure
and contrast**; and a Laplacian median for **noise**, which sets all three
smoothing radii.

Measured across nine plates of one subject — under- and over-exposed, flat and
harsh contrast, dark-on-light, a grey ground, noisy, and heavily compressed:

| | fixed defaults | auto |
|---|---|---|
| spread in subject coverage | **2.5×** | **1.0×** |
| spread in depth range | 1.1× | 1.1× |
| worst-case strand length | 66 | **90** |

The coverage figure is the important one. With fixed defaults, four of the
nine plates came out at 100% coverage — the silhouette had swallowed the whole
frame, background included. Auto brings all nine to within half a percent of
the true subject area, and its worst plate still draws longer strands than the
best case of the fixed defaults.

Two findings from building it, both of which are now load-bearing:

- **Contrast amplifies noise.** The smoothing decision has to be made on the
  noise as the flow field will see it, not as it arrives. Measured before this
  was accounted for, the underexposed plate came out at a third the strand
  length of the others: auto was setting clean-render smoothing on a field it
  had just stretched by two.
- **Otsu is a cap, not a floor.** Used as a floor it is actively wrong on a
  portrait: a hard-lit face has enough dark tone that the variance split lands
  inside the subject. On a test plate that discarded **15% of the face**, where
  a cut three times lower kept **97%** of it with no background bleeding in.
  The border's lower quartile is the reading that counts, because it stays
  background even when the subject runs off the edge of the frame.
- **The contrast curve pivots on 0.5.** A subject sitting at 0.35 gets pushed
  lower as it is stretched, and its shadow end clips to a flat zero — a region
  with no gradient at all, where the flow field is degenerate. A new
  **Exposure** step centres the subject first. On the underexposed plate that
  recovered 40% of its tonal range and doubled the strand length.

What auto deliberately does **not** touch: dot size, spacing, colour, fill
mode, where the wipe sits. Those are choices, not measurements, and automating
a choice only takes it away.

The two sets are disjoint by construction — `Auto.OWNED` and `Presets.OWNED`
share no key, and there is a test that says so. That is what lets a mode and a
plate change independently: switching mode never disturbs the calibration, and
loading an image never disturbs the mode.

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

The contrast curve is the other thing the silhouette has to come before, for
the same reason on the other axis: **the curve clips**. At the default
`imageContrast` of 1.35 a tone of 0.08 maps to exactly zero, so a shadow that
is genuinely part of the subject was gone before any threshold could see it —
measured on a five-band test frame, the deep-shadow band read **0% inside the
silhouette at every mask threshold the tool offers**. The cut is now taken
from the tone as it arrived, so lowering **Silhouette cut** actually reaches
into the shadows: the same band now reads 100%. With **Invert depth** on the
clipping removed the highlights instead; it is symmetric.

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

**Photo hand-over** is what makes the split read as one subject rather than two
things stacked. Left alone, the photograph carries on at full strength beneath
the dots and the two representations fight: the picture still reads as the
subject and the dots read as something laid over the top of it. Taking the
photograph *back down* across the same edge the dots come up on hands the
subject from one drawing to the other. The gradient that does it is built from
the very same wipe geometry the region field uses — one `wipeGeometry`, two
callers — so the two edges coincide exactly rather than drifting apart at odd
angles or aspect ratios. It costs one gradient fill; there is no per-pixel
work.

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

## Keeping the lines intact

Two things displace a dot away from the contour it was placed on, and both
used to push it *sideways* — which is the one direction where a difference is
maximally visible. A line survives being moved a long way; what destroys it is
neighbouring dots being moved by different amounts.

**Relief.** Depth exaggeration used to read the raw depth gradient once per
dot, with a magnitude that saturated as `min(1, |grad D| * 14)`. On a
photograph that swings from nothing to full over a couple of pixels, so two
dots a spacing apart on the same contour got shoved by different amounts, and
the line tore. Measured on a photographic depth field at low smoothing — which
is exactly what the precision settings above ask for — the worst 1% of
neighbouring pairs differed by **137% of the mean displacement**: effectively
kicked in opposite directions. On a mathematically smooth dome the same
measurement reads a hundredth of that, which is why the flaw hides in synthetic
tests and shows up on real work.

It is now a field. Direction still comes from the gradient, but magnitude comes
from **depth** — which is very nearly constant along a contour, because a
contour *is* an iso-depth line — and the whole field is smoothed by **Relief
coherence** before anything samples it. At the default the worst-1% figure
drops to 35%, a 3.9× reduction, while the mean displacement is unchanged: the
relief survives, only the incoherence goes.

Because the relief now applies across the whole surface instead of spiking at
edges, the same slider value bites roughly ten times harder on average. Depth
exaggeration's default drops from 6 to 3 to match.

**Randomness.** The jitter was split 0.55 across the contour and 0.35 along it,
under a comment claiming the split kept lines legible — it did the opposite.
Sliding a dot forwards along the line it is already drawing is nearly
invisible; sliding it sideways is what breaks the line up. At the default
randomness of 0.12 the old split more than doubled a line's measured wobble,
from 0.11 to 0.28. **Jitter along** now sets the balance and defaults to 0.75
in favour of along: the same randomness now measures 0.13, indistinguishable
from no randomness at all, while the variation in dot *spacing* — the part
that actually stops the field looking mechanical — is untouched.

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
| **Depth → density** | How much depth tightens the contour spacing and the dots along them. This is the channel that decides *how much of a region is covered at all*, as opposed to how the covering looks. |

Size and colour at full strength is the old behaviour, and it is still the
default — the channels reproduce it exactly, not approximately. Turning size
down and leaving colour up is usually the better-looking half of the trade:
uniform dots keep the grain legible and let colour do the modelling, which is
what the halftone references are actually doing.

### Covering a segment rather than a tonal range

Density deserves its own note, because it is the one that surprises people.
Contour separation and dot spacing were both modulated by depth with no way to
turn it off, so a selected region was never covered evenly — it was covered in
proportion to its brightness. Measured across five tonal bands of one object,
with identical geometry in each and only the tone changing:

| | dots, before | dots, at Depth → density 0 |
|---|---|---|
| blown highlight | 974 | 544 |
| bright | 929 | 501 |
| midtone | 355 | 477 |
| dark | 212 | 514 |
| deep shadow | 0 — outside the silhouette entirely | 569 |

A **12.8× spread** across the bands, and a whole band missing. At density 0 the
spread is **1.2×**. Add `Depth → size 0` and `Depth → colour 0` on top and ink
coverage lands between 27.8% and 33.8% in every band from blown highlight to
deep shadow — the segment treated as a segment, not as a tonal range that
happens to sit inside one.

Leave density at 1 when you want the classic halftone, where near surfaces
carry more line. Take it to 0 when the selection is *this part of the object*
and you want all of it.

**Tint from image** switches the colour channel's source from depth to the
picture's own tone. Size then carries the geometry while colour carries the
photograph — two different signals on two different channels, which is the
whole reason to keep them apart.

## Rows, and what a lattice needs

**Row align** locks each contour's dots to a common phase instead of giving
every line a random one. Aligned, the dots line up across neighbouring contours
as well as along them, and the field starts reading as a lattice lying on the
surface rather than as independent bands of dots — the look of a panelled hull
or a wing.

Be realistic about its reach. The phase is locked where each line *starts*, so
the alignment holds along parallel, fairly straight runs and drifts apart as
contours curve away from one another. On a panelled flank it does most of what
you want; on a tightly curved form it is a small effect. A lattice that stays
locked all the way around a surface is not recoverable from a photograph at
all: it needs the surface's own parametrisation, which means real geometry —
a UV pass out of Blender, or render targets from three.js. That is the honest
ceiling of the image-only pipeline, and it is where the `v6-3d` work points.

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

**Silhouette** — Use image alpha, Silhouette cut, Silhouette despeckle,
Silhouette cleanup.

**Overlay** — Show photograph, Photo fade, Photo hand-over (fades the picture
out as the dots come up), Partial overlay (the wipe), Wipe position / angle /
softness, Edge dissolve.

**Image** — Depth floor (where the relief starts; no longer carves the
silhouette), Contrast, Invert depth (for a subject lit dark-on-light).

**Depth** — Depth exaggeration (shifts each dot along the relief field; this
is what makes the bands bulge towards the viewer rather than read as a flat
contour map), Relief coherence (how far that field is smoothed before it is
applied), Depth contrast, Depth smoothing (turns a noisy photograph into a
continuous surface — contours need this).

**Contours** — Line density, Line spacing, Flow strength (0 = straight lines
at the base angle, 1 = pure depth contours), Flow distortion, Base angle,
Flow coherence.

**Dots** — Grid fill, Shape, Dot size, Size variation, Size falloff, Dot
spacing, Randomness, Row align (locks the dots to a common phase across
contours), Jitter along (how much of that randomness runs along the contour
rather than across it).

**Depth mapping** — Depth → size, Depth → colour, Depth → opacity, Depth →
density, Tint from image.

**Colour** — Background, Far colour, Near colour, Colour falloff.

Dot spacing is floored at a little over one dot diameter, so the largest,
densest dots cannot fuse into a solid line and collapse the halftone into fill.

## Getting a good result from a photograph

The pipeline reads luminance as depth, so it rewards images that are already
lit like a depth map: a single strong light, a dark background, and the subject
falling off into shadow at its edges. Studio portraits and product shots on
black work best.

- Set the **silhouette** first, and independently: **Silhouette cut** so the
  background drops out, **Silhouette despeckle** until the edge stops
  crawling, **Silhouette cleanup** as low as the edge tolerates. Nothing you
  do afterwards will move it.
- Then **Depth smoothing** — raise it until the contours stop breaking into
  small closed loops and start reading as bands. It is free now: it costs
  structure but not silhouette.
- **Flow strength** below about 0.5 is where the piece stops being a contour
  map and starts being a striped halftone; both are useful.
- If the subject is dark against a light ground, turn on **Invert depth**
  first — nothing else will behave until the near/far sense is right.

### When the dots scatter instead of drawing lines

Short broken arcs with gaps between them, rather than continuous strands,
means the **silhouette is speckled** and the tracer is stopping dead every
time a contour crosses an island or a pinhole. Thresholding a low-quality
plate — sensor noise, compression blocking — produces exactly that.

It is worth being precise about how much this costs. On a noisy plate at the
precision settings below, contours shattered from **62 strands averaging 266
points into 513 fragments averaging 33**. The same dots, scattered instead of
drawn.

**Silhouette despeckle** is the fix and it is free. It blurs the mask and then
re-hardens it about half coverage — a majority filter, so islands smaller than
the radius vanish and pinholes fill, while a straight edge's half-coverage
contour does not move at all. Compared on the same plate: blurring with
Silhouette cleanup denoises just as well but adds 1,496 pixels of dilation,
where despeckle adds none. On a clean plate it changes nothing whatsoever —
same contour count, same mean length, same dot count to the unit.

Despeckle alone takes the mean strand from 33 back to 101; putting **Depth
smoothing** and **Flow coherence** back up as well returns it to 266, which is
what the same subject gives when the plate is clean.

### A low-quality plate wants the opposite of the precision settings

The table below is tuned for a clean render. A noisy or compressed photograph
needs the smoothing it tells you to remove — the structure those controls
throw away is noise, not form, and keeping it is what shatters the contours:

| control | low-quality plate |
|---|---|
| Silhouette despeckle | 3–5 |
| Silhouette cleanup | 0–1 (despeckle does the denoising) |
| Depth smoothing | 10–16 |
| Flow coherence | 6–10 |
| Dot spacing / Line spacing | wider — fine grain has nothing real to resolve |

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
| Depth exaggeration | 0–3 | safe now, but 0 is still the sharpest |
| Relief coherence | 10+ | keeps neighbouring dots moving together |
| Jitter along | 0.75–1 | randomness that does not break the lines |
| Randomness | 0–0.05 | precision, not texture |
| Depth → density | 0 | covers a chosen segment evenly, lights and darks alike |
| Silhouette cut | 0.02 | now that it reaches into the shadows |
| Photo hand-over | 0.85–1 | the picture recedes as the dots take over |
| Row align | 0.7–1 | rows that line up across contours, not just along |
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
js/presets.js         the three modes; look parameters only
js/auto.js            reads the plate; image parameters only
js/artdirection.js    the four layers, the six presets, intensity, palette
js/generative.js      the field for Concepts, where there is no photograph
js/matte.js           telling subject from background: plate, depth, alpha
js/zip.js             tiny stored-entry zip writer, for Download
js/ui.js              declarative control schema + panel
js/app.js             p5 sketch, pipeline orchestration, I/O
vendor/p5.min.js      p5.js 1.9.4
```
