/* ============================================================================
 * field.js — the two fields the whole renderer is built on.
 *
 *   FIELD 1  DEPTH  D(x,y)   black = far, white = near.
 *                            Decides where dots exist, how big they are and
 *                            how densely they pack.
 *
 *   FIELD 2  FLOW   F(x,y)   derived from the gradient of depth:
 *                              grad D = (dD/dx, dD/dy)
 *                              F      = (-dD/dy, dD/dx)
 *                            i.e. F runs *along* the iso-depth contours, so
 *                            streamlines of F wrap around the form.
 *
 *   FIELD 3  REGION R(x,y)   where dots are allowed to exist at all. The
 *                            object's own silhouette, intersected with an
 *                            authored area — which is what lets the dots
 *                            cover part of the subject and leave the rest of
 *                            the photograph showing.
 * ==========================================================================*/
var CD = window.CD || {};

(function (CD) {
  'use strict';

  var clamp = CD.clamp, lerp = CD.lerp, smoothstep = CD.smoothstep;

  /* --------------------------------------------------------------------------
   * DEPTH
   * ------------------------------------------------------------------------*/

  /* Symmetric contrast curve about 0.5. amount 1 = identity. */
  function contrastCurve(v, amount) {
    if (amount === 1) return v;
    var c = clamp((v - 0.5) * amount + 0.5, 0, 1);
    /* blend in an S-curve so strong contrast rolls off instead of clipping */
    var s = smoothstep(0, 1, c);
    var k = clamp((amount - 1) / 3, 0, 1);
    return lerp(c, s, k);
  }

  /* An image with a real alpha channel carries its own silhouette: exact to
   * the pixel, and including the parts of the subject too dark to threshold —
   * a black tyre against a black ground is the case that matters. Worth using
   * whenever it is there. Returns null for an effectively opaque image, which
   * is most of them. */
  function alphaCoverage(px, n) {
    var a = new Float32Array(n), cut = 0, i;
    for (i = 0; i < n; i++) {
      var v = px[i * 4 + 3];
      a[i] = v / 255;
      if (v < 250) cut++;
    }
    return cut > n * 0.02 ? a : null;
  }

  /* The picture's own tonality, straight off the pixels — not inverted, not
   * contrasted, not thresholded. Depth says how far away a point is; tone says
   * how light it looked. They are different signals, and having both means a
   * dot's colour can follow the photograph while its size follows the
   * geometry. */
  function toneField(px, w, h) {
    var f = new CD.Field(w, h, 1), d = f.data, n = w * h;
    for (var i = 0; i < n; i++) {
      d[i] = 0.2126 * (px[i * 4] / 255) +
             0.7152 * (px[i * 4 + 1] / 255) +
             0.0722 * (px[i * 4 + 2] / 255);
    }
    return f;
  }

  /* Build the depth field from an RGBA pixel buffer, reading luminance as
   * depth. This is the fallback path: brightness is only a proxy for
   * geometry, and where a photograph's tones disagree with its form (a dark
   * iris on a lit face, a specular in a crease) the contours follow the tones.
   * `buildDepthFromValues` is the same pipeline fed a real depth map instead.
   *
   * params: imageContrast, threshold, invert, depthSmoothing, depthContrast
   * returns { depth: Field(1ch, raw 0..1 relief),
   *           mask:  Field(1ch, 0..1 negative-space coverage),
   *           grad:  Field(2ch, dD/dx dD/dy) }
   */
  function buildDepth(px, w, h, p, alpha) {
    var i, n = w * h;
    var vals = new Float32Array(n);

    /* luminance -> depth. White is near, black is far, per the brief. */
    for (i = 0; i < n; i++) {
      var r = px[i * 4] / 255, g = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255;
      vals[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    if (alpha === undefined) {
      alpha = p.useAlpha === false ? null : alphaCoverage(px, n);
    }
    return buildDepthFromValues(vals, w, h, p, alpha);
  }

  /* The depth pipeline proper, from a single-channel 0..1 grid in which 1 is
   * near and 0 is far — whether that came from luminance or from a depth
   * model. Everything downstream (gradient, flow, streamlines, dots) only ever
   * sees the result of this, so the two sources are interchangeable.
   *
   * `vals` is consumed; pass a copy if the caller still needs it. `alpha`, if
   * given, is the subject's own coverage and is used as the silhouette in
   * place of a threshold.
   */
  function buildDepthFromValues(vals, w, h, p, alpha) {
    var i, x, y, n = w * h;
    var depth = new CD.Field(w, h, 1);
    var d = depth.data;

    /* 1. orientation. Invert when the subject reads dark-on-light. */
    for (i = 0; i < n; i++) {
      d[i] = p.invert ? 1 - vals[i] : vals[i];
    }

    /* 2. SILHOUETTE, and it has to be taken here — before the contrast curve
     *    as well as before the relief blur.
     *
     *    Smoothing depth is what turns a noisy photograph into a continuous
     *    surface, but it also spreads a lit subject out into a dark
     *    background. A mask read after that blur is a dilated one: at the
     *    default smoothing the silhouette gains a fifth of the subject's area
     *    in ground that was never part of it, and dots end up floating off
     *    the object. Taken before, the edge is where the picture says it is,
     *    and relief smoothing can go as high as the contours need without
     *    touching it.
     *
     *    The contrast curve is the other thing it has to come before, and for
     *    the same reason in the other axis: the curve clips. At the default
     *    imageContrast of 1.35 a tone of 0.08 maps to exactly zero, so a
     *    shadow that is genuinely part of the subject is gone before any
     *    threshold can see it and no setting recovers it. Measured on a
     *    five-band test frame, the deep-shadow band read 0% inside the
     *    silhouette at every mask threshold offered. Reading the tone as it
     *    arrived — inverted if asked, nothing else — is what lets the cut
     *    reach into the shadows. With Invert depth on, the same clipping
     *    removes the highlights instead; it is symmetric.
     *
     *    The mask gets its own small blur — enough to settle a noisy edge and
     *    no more. */
    var mask = new CD.Field(w, h, 1);
    var m = mask.data;

    if (alpha) {
      for (i = 0; i < n; i++) m[i] = alpha[i];
    } else {
      var edge = depth.clone();
      edge.blur(p.maskSmoothing === undefined ? 1 : p.maskSmoothing, 2);
      var mt = p.maskThreshold === undefined ? p.threshold : p.maskThreshold;
      for (i = 0; i < n; i++) m[i] = smoothstep(mt, mt + 0.05, edge.data[i]);
    }
    /* Despeckle, by majority vote of the neighbourhood.
     *
     * Thresholding a low-quality plate — sensor noise, compression blocking —
     * gives a silhouette riddled with islands and pinholes, and the tracer
     * stops dead every time a line crosses one. Measured on a noisy plate at
     * the precision settings, contours shattered from 62 strands averaging
     * 266 points into 513 fragments averaging 33: the same dots, scattered
     * instead of drawn.
     *
     * Blurring the mask harder fixes that but dilates the silhouette, which
     * is the thing the ordering above exists to prevent. Blurring and then
     * re-hardening about half coverage is the way out: it is a majority
     * filter, so islands smaller than the radius vanish and pinholes fill,
     * while a straight edge's half-coverage contour does not move at all.
     * Cleanup stays available for deliberately softening the edge. */
    if (p.maskDespeckle > 0) {
      var vote = mask.clone();
      vote.blur(p.maskDespeckle, 2);
      var vd = vote.data;
      for (i = 0; i < n; i++) m[i] = smoothstep(0.42, 0.58, vd[i]);
    }

    /* feather the mask edge slightly so contours die out instead of snapping */
    mask.blur(1, 1);

    /* 3. Exposure: centre the subject's tones on the pivot before stretching
     *    them. contrastCurve is a gain about 0.5, so a subject that sits at
     *    0.35 gets pushed down as it is stretched and its shadow end clips to
     *    a flat zero — a region with no gradient at all, where the flow field
     *    is degenerate and the contours fall apart. Measured on an
     *    underexposed plate that cost 40% of the subject's tonal range and
     *    halved the mean strand length. Shifting first costs nothing and the
     *    stretch then lands symmetrically.
     *
     *    It goes after the silhouette so that the mask threshold stays in the
     *    plate's own tone space, which is where it can be measured. */
    if (p.exposure) {
      for (i = 0; i < n; i++) d[i] = clamp(d[i] + p.exposure, 0, 1);
    }

    /* 4. image-level contrast, now that the silhouette is safely decided. */
    if (p.imageContrast !== 1) {
      for (i = 0; i < n; i++) d[i] = contrastCurve(d[i], p.imageContrast);
    }

    /* 5. relief smoothing. Streamlines can only be continuous if depth is
     *    continuous, and this is what buys that — now at no cost to the
     *    silhouette, which is already decided. */
    depth.blur(p.depthSmoothing, 3);

    /* 6. depth contrast — separates near from far, steepening the relief. */
    if (p.depthContrast !== 1) {
      for (i = 0; i < n; i++) d[i] = contrastCurve(d[i], p.depthContrast);
    }

    /* 7. the depth floor. Everything under it flattens to zero relief, and
     *    the remaining range is renormalised so the full dot-size range is
     *    still usable. This no longer carves the silhouette — that is the
     *    mask's job, above. */
    var t = p.threshold, inv = 1 / Math.max(1e-4, 1 - t);
    for (i = 0; i < n; i++) d[i] = clamp((d[i] - t) * inv, 0, 1);

    /* 8. gradient of depth (Sobel) — the source of the flow field. */
    var grad = new CD.Field(w, h, 2);
    var gd = grad.data;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        var x0 = x > 0 ? x - 1 : 0, x1 = x < w - 1 ? x + 1 : w - 1;
        var y0 = y > 0 ? y - 1 : 0, y1 = y < h - 1 ? y + 1 : h - 1;
        var tl = d[y0 * w + x0], tc = d[y0 * w + x], tr = d[y0 * w + x1];
        var ml = d[y * w + x0], mr = d[y * w + x1];
        var bl = d[y1 * w + x0], bc = d[y1 * w + x], br = d[y1 * w + x1];
        var gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
        var gy = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
        gd[(y * w + x) * 2] = gx * 0.125;
        gd[(y * w + x) * 2 + 1] = gy * 0.125;
      }
    }

    /* 9. RELIEF — the displacement field that depth exaggeration applies.
     *
     * Sampling the raw gradient once per dot is what tears contours apart.
     * The displacement's magnitude was a saturating function of |grad D|,
     * which on a photograph swings from nothing to full over a couple of
     * pixels, and its direction is the gradient — perpendicular to the
     * contour, the one direction in which a difference is maximally visible.
     * So two neighbouring dots on the same line got shoved by different
     * amounts, sideways, and the line broke up. Measured on a photographic
     * depth field at low smoothing, the step between neighbours reached half
     * a dot radius; on a mathematically smooth dome it is a hundredth of that,
     * which is why the flaw hides on synthetic tests and shows on real work.
     *
     * Built as a field instead. Direction still comes from the gradient, but
     * magnitude comes from depth — and depth is very nearly constant along a
     * contour, because a contour *is* an iso-depth line — and the whole field
     * is then smoothed. Neighbouring dots now receive almost the same
     * displacement, so a line translates as a whole instead of shredding,
     * while lines at different depths still shift by different amounts and
     * the relief survives.
     */
    var relief = new CD.Field(w, h, 2);
    var rl = relief.data;
    for (i = 0; i < n; i++) {
      var rx = gd[i * 2], ry = gd[i * 2 + 1];
      var rm = Math.hypot(rx, ry);
      if (rm > 1e-5) {
        var k = d[i] / rm;
        rl[i * 2] = rx * k;
        rl[i * 2 + 1] = ry * k;
      }
    }
    relief.blur(p.reliefCoherence === undefined ? 10 : p.reliefCoherence, 2);

    return { depth: depth, mask: mask, grad: grad, relief: relief, w: w, h: h };
  }

  /* --------------------------------------------------------------------------
   * REGION
   *
   * Silhouette AND authored area, multiplied:
   *
   *     R = mask * wipe
   *
   * The intersection is the whole point. A wipe on its own is a rectangle
   * across the frame, and dots marching off the subject onto the background
   * read as a filter laid over the picture; multiplied by the silhouette they
   * stop at the subject's edge as well as at the wipe, which is what makes a
   * partial overlay look deliberate rather than applied.
   * ------------------------------------------------------------------------*/

  /* Soft-edged linear wipe, evaluated in normalised field coordinates.
   * `wipeAngle` is the direction dots run towards: 0 puts them on the right,
   * 90 at the bottom, and adding 180 swaps which side is covered. */
  /* The wipe as one line in normalised coordinates. Both the region builder
   * and the compositor that fades the photograph out read it from here, so
   * the dots appearing and the photograph receding are two halves of the same
   * edge rather than two edges that merely look alike. */
  function wipeGeometry(p) {
    var a = (p.wipeAngle || 0) * Math.PI / 180;
    var ux = Math.cos(a), uy = Math.sin(a);

    /* Project the four corners onto the wipe axis to find its extent, so
     * position reads 0..1 across the frame whatever the angle. */
    var lo = Infinity, hi = -Infinity;
    var corners = [[0, 0], [1, 0], [0, 1], [1, 1]];
    for (var c = 0; c < 4; c++) {
      var t = (corners[c][0] - 0.5) * ux + (corners[c][1] - 0.5) * uy;
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }

    var half = Math.max(0, p.wipeFeather) * 0.5;
    return { ux: ux, uy: uy, lo: lo, span: (hi - lo) || 1,
             e0: p.wipePosition - half, e1: p.wipePosition + half };
  }

  /* Where the dots are allowed to live, relative to the subject.
   *
   *   subject     inside the silhouette — the halftone treatments
   *   background  outside it — the subject stays a photograph and the dots
   *               become the ground it sits on
   *   edge        a band straddling the boundary, so the pattern and the
   *               subject interlock instead of one sitting inside the other
   *
   * The band is measured by blurring the silhouette and reading how far the
   * coverage has fallen from solid: that is a cheap distance from the edge,
   * and it works equally on both sides of it. */
  function regionSource(mask, w, h, p) {
    var src = p.regionSource || 'subject';
    if (src === 'subject') return mask.clone();

    var out = new CD.Field(w, h, 1);
    var o = out.data, m = mask.data, n = w * h, i;

    if (src === 'background') {
      for (i = 0; i < n; i++) o[i] = 1 - clamp(m[i], 0, 1);
      return out;
    }

    /* edge band */
    var soft = mask.clone();
    soft.blur(Math.max(1, Math.round(p.edgeBand || 12)), 2);
    var sd = soft.data;
    for (i = 0; i < n; i++) {
      /* 1 on the boundary, falling to 0 well inside and well outside */
      o[i] = clamp(1 - Math.abs(2 * clamp(sd[i], 0, 1) - 1), 0, 1);
      o[i] = smoothstep(0.15, 0.75, o[i]);
    }
    return out;
  }

  /* Depth as distance from the silhouette rather than from the picture's own
   * tones. Contours of a distance field are offset curves of the outline, so
   * streamlines of it ring the subject — the fingerprint. The blurred mask is
   * a distance field everywhere it matters, and costs one separable blur
   * instead of a proper transform. */
  function distanceDepth(mask, w, h, radius) {
    var f = mask.clone();
    f.blur(Math.max(2, Math.round(radius)), 3);
    var d = f.data, n = w * h, i;
    var lo = Infinity, hi = -Infinity;
    for (i = 0; i < n; i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
    var span = (hi - lo) || 1;
    for (i = 0; i < n; i++) d[i] = (d[i] - lo) / span;
    return f;
  }

  function buildRegion(mask, w, h, p) {
    var region = regionSource(mask, w, h, p);
    if (!p.wipe) return region;

    var r = region.data;
    var g = wipeGeometry(p);
    var ux = g.ux, uy = g.uy, lo = g.lo, span = g.span, e0 = g.e0, e1 = g.e1;

    for (var y = 0; y < h; y++) {
      var v = (y + 0.5) / h;
      for (var x = 0; x < w; x++) {
        var u = (x + 0.5) / w;
        var tt = (((u - 0.5) * ux + (v - 0.5) * uy) - lo) / span;
        r[y * w + x] *= smoothstep(e0, e1, tt);
      }
    }

    return region;
  }

  /* Swap in a different depth field and rebuild everything derived from it.
   * The mask is kept: the silhouette is still the silhouette, only the
   * surface the contours follow has changed. */
  function withDepth(dep, depth, p) {
    var w = dep.w, h = dep.h, n = w * h;
    var d = depth.data;

    var grad = new CD.Field(w, h, 2);
    var gd = grad.data;
    var x, y;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        var x0 = x > 0 ? x - 1 : 0, x1 = x < w - 1 ? x + 1 : w - 1;
        var y0 = y > 0 ? y - 1 : 0, y1 = y < h - 1 ? y + 1 : h - 1;
        var tl = d[y0 * w + x0], tc = d[y0 * w + x], tr = d[y0 * w + x1];
        var ml = d[y * w + x0], mr = d[y * w + x1];
        var bl = d[y1 * w + x0], bc = d[y1 * w + x], br = d[y1 * w + x1];
        gd[(y * w + x) * 2] = ((tr + 2 * mr + br) - (tl + 2 * ml + bl)) * 0.125;
        gd[(y * w + x) * 2 + 1] = ((bl + 2 * bc + br) - (tl + 2 * tc + tr)) * 0.125;
      }
    }

    var relief = new CD.Field(w, h, 2);
    var rl = relief.data;
    for (var i = 0; i < n; i++) {
      var rx = gd[i * 2], ry = gd[i * 2 + 1];
      var rm = Math.hypot(rx, ry);
      if (rm > 1e-5) { var k = d[i] / rm; rl[i * 2] = rx * k; rl[i * 2 + 1] = ry * k; }
    }
    relief.blur(p.reliefCoherence === undefined ? 10 : p.reliefCoherence, 2);

    return { depth: depth, mask: dep.mask, grad: grad, relief: relief, w: w, h: h };
  }

  /* --------------------------------------------------------------------------
   * FLOW
   *
   * A contour direction is a *line* field, not a vector field: theta and
   * theta+PI mean the same thing. Averaging raw vectors would cancel them out
   * at every sign flip, so the field is carried as the doubled angle
   * (cos2t, sin2t), which is flip-invariant, smoothed there, and halved back
   * on sampling. This is what makes the streamlines continuous across the
   * flat, gradient-free regions of a face.
   * ------------------------------------------------------------------------*/
  function buildFlow(dep, p, noise2D) {
    var w = dep.w, h = dep.h, n = w * h;
    var gd = dep.grad.data;
    var flow = new CD.Field(w, h, 2);
    var f = flow.data;
    var i;

    var baseA = (p.flowAngle || 0) * Math.PI / 180;
    var baseX = Math.cos(2 * baseA), baseY = Math.sin(2 * baseA);
    var strength = clamp(p.flowStrength, 0, 1);

    /* 1. Contour direction, weighted by how much the depth field actually
     *    says here. Flat regions contribute nothing rather than contributing
     *    a guess, so step 2 can fill them in from their neighbours. */
    for (i = 0; i < n; i++) {
      var gx = gd[i * 2], gy = gd[i * 2 + 1];
      /* F = (-dD/dy, dD/dx): the gradient turned ninety degrees, so it runs
       * along the contour instead of across it. */
      var fx = -gy, fy = gx;
      var mag2 = fx * fx + fy * fy;
      if (mag2 < 1e-12) {
        f[i * 2] = 0; f[i * 2 + 1] = 0;
      } else {
        var wgt = Math.sqrt(Math.sqrt(mag2));       // confidence
        f[i * 2] = ((fx * fx - fy * fy) / mag2) * wgt;
        f[i * 2 + 1] = ((2 * fx * fy) / mag2) * wgt;
      }
    }

    /* 2. Coherence blur. Because the field is carried as a doubled angle,
     *    this averages *lines* rather than vectors, so it diffuses direction
     *    into the flat regions instead of cancelling it out there. This is
     *    what keeps streamlines running across a cheek or a palm. */
    flow.blur(p.flowSmoothing, 2);

    /* 3. Artistic blend towards a uniform base direction. At 0 the lines are
     *    straight; at 1 they are pure depth contours. */
    for (i = 0; i < n; i++) {
      var l = Math.hypot(f[i * 2], f[i * 2 + 1]);
      var ux, uy;
      if (l > 1e-7) { ux = f[i * 2] / l; uy = f[i * 2 + 1] / l; }
      else { ux = baseX; uy = baseY; }
      f[i * 2] = ux * strength + baseX * (1 - strength);
      f[i * 2 + 1] = uy * strength + baseY * (1 - strength);
    }

    /* 4. Flow distortion: rotate the field by low-frequency noise so the
     *    contours breathe instead of reading as a survey map. */
    if (p.flowDistortion > 0.0001 && noise2D) {
      var sc = 0.006 * (p.flowNoiseScale || 1);
      var amt = p.flowDistortion * Math.PI;
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var idx = (y * w + x) * 2;
          var a = 0.5 * Math.atan2(f[idx + 1], f[idx]);
          a += (noise2D(x * sc, y * sc) - 0.5) * 2 * amt;
          f[idx] = Math.cos(2 * a);
          f[idx + 1] = Math.sin(2 * a);
        }
      }
    }

    /* 5. Normalise, so bilinear sampling is not biased by magnitude. */
    for (i = 0; i < n; i++) {
      var m = Math.hypot(f[i * 2], f[i * 2 + 1]);
      if (m > 1e-9) { f[i * 2] /= m; f[i * 2 + 1] /= m; }
      else { f[i * 2] = baseX; f[i * 2 + 1] = baseY; }
    }

    return flow;
  }

  /* Unit contour direction at a continuous grid position. */
  function dirAt(flow, x, y) {
    var cx = flow.sample(x, y, 0), cy = flow.sample(x, y, 1);
    var a = 0.5 * Math.atan2(cy, cx);
    return { x: Math.cos(a), y: Math.sin(a), a: a };
  }

  CD.alphaCoverage = alphaCoverage;
  CD.toneField = toneField;
  CD.buildDepth = buildDepth;
  CD.buildRegion = buildRegion;
  CD.regionSource = regionSource;
  CD.distanceDepth = distanceDepth;
  CD.wipeGeometry = wipeGeometry;
  CD.buildDepthFromValues = buildDepthFromValues;
  CD.withDepth = withDepth;
  CD.buildFlow = buildFlow;
  CD.dirAt = dirAt;
  CD.contrastCurve = contrastCurve;
})(CD);
