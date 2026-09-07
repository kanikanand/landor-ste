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

  /* Build the depth field from an ImageData-like {data,width,height}.
   *
   * params: imageContrast, threshold, invert, depthSmoothing, depthContrast
   * returns { depth: Field(1ch, raw 0..1 relief),
   *           mask:  Field(1ch, 0..1 negative-space coverage),
   *           grad:  Field(2ch, dD/dx dD/dy) }
   */
  function buildDepth(px, w, h, p) {
    var i, x, y, n = w * h;
    var depth = new CD.Field(w, h, 1);
    var d = depth.data;

    /* Tonality: how light or dark the photograph is, 1 light and 0 dark.
     * Written to its own array and never fed back into the depth pipeline, so
     * the surface renderer is bit-for-bit what it always was. This is what the
     * subject/background separation reads.
     *
     * It is deliberately RAW — no image contrast, never inverted. Contrast is
     * a look control, and running it first destroys the very signal the
     * separation needs: at 1.35 on a vignetted olive wall the wall's shadowed
     * corner, the hair and the shirt all clip to zero together, and no flood
     * can tell them apart after that. Invert is likewise a different question:
     * it says which side of the threshold is the subject, not which parts of
     * the picture are dark. */
    var tone = new CD.Field(w, h, 1);
    var tn = tone.data;

    /* 1. luminance -> depth. White is near, black is far, per the brief. */
    for (i = 0; i < n; i++) {
      var r = px[i * 4] / 255, g = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255;
      var lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      tn[i] = lum;
      d[i] = p.invert ? 1 - lum : lum;
    }

    /* 2. image-level contrast, before anything structural happens. */
    if (p.imageContrast !== 1) {
      for (i = 0; i < n; i++) d[i] = contrastCurve(d[i], p.imageContrast);
    }
    /* Only enough blur to kill grain: tonality is a local question, and
     * averaging it over the depth-smoothing radius would smear it across a
     * whole stack of contour bands. */
    tone.blur(2, 2);

    /* 3. depth smoothing. This is what turns a noisy photograph into a
     *    surface: streamlines can only be continuous if depth is continuous. */
    depth.blur(p.depthSmoothing, 3);

    /* 4. depth contrast — separates near from far, steepening the relief. */
    if (p.depthContrast !== 1) {
      for (i = 0; i < n; i++) d[i] = contrastCurve(d[i], p.depthContrast);
    }

    /* 5. threshold carves the negative space. Everything under the threshold
     *    is *nothing* — pure background, not a dark dot. The remaining range
     *    is renormalised so the full dot-size range is still usable. */
    var mask = new CD.Field(w, h, 1);
    var m = mask.data;
    var t = p.threshold, inv = 1 / Math.max(1e-4, 1 - t);
    var soft = 0.05;
    for (i = 0; i < n; i++) {
      m[i] = smoothstep(t, t + soft, d[i]);
      d[i] = clamp((d[i] - t) * inv, 0, 1);
    }
    /* feather the mask edge slightly so contours die out instead of snapping */
    mask.blur(1, 1);

    /* 6. gradient of depth (Sobel) — the source of the flow field. */
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

    return { depth: depth, tone: tone, mask: mask, grad: grad, w: w, h: h };
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

  /* Where the subject stops and the background begins.
   *
   * A single luminance threshold cannot answer that question. On a portrait
   * against a mid-grey wall it selects a *brightness band* — the lit face,
   * without the dark hair and without the dark shirt — so the edge contours
   * ended up ringing the cheekbones instead of the head. That is the
   * "picking the darkest regions rather than object/background separation"
   * problem, and no threshold value fixes it, because the subject is not a
   * band of brightness.
   *
   * The background is, though: it is the region that touches the frame and
   * stays the tone the frame is. So it is found by flooding inwards from the
   * border, and everything the flood cannot reach is the subject, however
   * light or dark it happens to be. Two conditions hold the flood in:
   *
   *   - it may not stray far in tone from the frame's own median, and
   *   - it may not cross a cell where the tone is turning sharply, which is
   *     what stops it leaking through the rim of a lit face — there the face
   *     and the wall are the same grey, and only the steepness tells them
   *     apart.
   *
   * Both limits are measured from the frame rather than guessed. The frame is
   * background, so whatever tone it drifts through and whatever grain it
   * carries are things the flood must be allowed to cross; `Separation` is
   * headroom on top of that. Returns null when the answer is degenerate —
   * nothing found, or everything — and the caller falls back to the threshold
   * mask.
   */
  function subjectMask(tone, p) {
    var w = tone.w, h = tone.h, n = w * h;
    var tn = tone.data;
    var i, x, y;

    /* The slope of the picture, cell by cell. Where it turns sharply is where
     * the subject starts: a wall shades across a whole frame, so its slope per
     * cell is tiny; the rim of a face or the edge of hair climbs as fast as
     * the blur allows. That difference separates them even where their tones
     * meet, which a tone band alone cannot do, and it is the condition doing
     * the real work below — the tone band is only a guard against running away
     * down a soft ramp. */
    var slope = new Float32Array(n);
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        var x0 = x > 0 ? x - 1 : 0, x1 = x < w - 1 ? x + 1 : w - 1;
        var y0 = y > 0 ? y - 1 : 0, y1 = y < h - 1 ? y + 1 : h - 1;
        var gx = (tn[y * w + x1] - tn[y * w + x0]) * 0.5;
        var gy = (tn[y1 * w + x] - tn[y0 * w + x]) * 0.5;
        slope[y * w + x] = Math.hypot(gx, gy);
      }
    }

    var border = [];
    for (x = 0; x < w; x++) { border.push(x); border.push((h - 1) * w + x); }
    for (y = 0; y < h; y++) { border.push(y * w); border.push(y * w + w - 1); }

    function pct(arr, f) { return arr[Math.floor(f * (arr.length - 1))]; }
    function stat(cells, src, step) {
      var v = [];
      for (var k = 0; k < cells.length; k += (step || 1)) v.push(src[cells[k]]);
      v.sort(function (a, b) { return a - b; });
      return v;
    }

    /* How much grain the background carries, taken from the frame. The flood
     * must be allowed to cross that much and no more, so the barrier is a
     * multiple of it rather than an absolute figure — grain differs from
     * photograph to photograph, the ratio does not. Separation is that
     * multiple, and it is the only knob: raise it and the background spreads
     * past fainter edges, lower it and the flood stops sooner. Measured once
     * from the frame: let it drift upward as the region grows and it would
     * talk itself into crossing the hairline. */
    var sep = clamp(p.edgeTolerance, 0, 1);
    var lim = Math.max(0.004, pct(stat(border, slope), 0.9) * (1 + sep * 11));

    /* Separation loosens both limits together, so one slider means one thing:
     * how far the background is allowed to spread. The tone band below is
     * measured from the picture; this is the headroom on top of it. */
    var margin = 0.01 + sep * 0.25;
    var med = pct(stat(border, tn), 0.5);
    var band = margin;

    var seen = new Uint8Array(n);
    var stack = new Int32Array(n);
    var claimed = [];
    var sp = 0, count = 0;

    /* A single fixed tolerance cannot know that a vignetted wall drifts a
     * fifth of the range across a picture, and the frame alone cannot tell it
     * either — on a portrait the shoulders run off the bottom edge, so a
     * quarter of the frame is subject and any spread measured there is
     * poisoned by it. So the flood measures itself: claim conservatively, take
     * the tone range of what was claimed (which is background by
     * construction), widen to it, and go again. Two or three passes walk the
     * whole of a vignette; the slope barrier, fixed, is what stops the widening
     * band from wandering into the hair. */
    for (var pass = 0; pass < 6; pass++) {
      seen = new Uint8Array(n);
      sp = 0; count = 0;
      claimed.length = 0;

      var okCell = function (q) {
        return Math.abs(tn[q] - med) <= band && slope[q] <= lim;
      };
      var push = function (q) {
        if (!seen[q] && okCell(q)) { seen[q] = 1; stack[sp++] = q; }
      };
      for (i = 0; i < border.length; i++) push(border[i]);
      if (sp === 0) return null;

      while (sp > 0) {
        var q = stack[--sp];
        claimed.push(q);
        count++;
        var qx = q % w, qy = (q / w) | 0;
        if (qx > 0) push(q - 1);
        if (qx < w - 1) push(q + 1);
        if (qy > 0) push(q - w);
        if (qy < h - 1) push(q + w);
      }

      var grown = pass === 0 ? Infinity : count / Math.max(1, prevCount);
      var prevCount = count;
      if (pass > 0 && grown < 1.01) break;

      var v = stat(claimed, tn, 4);
      med = pct(v, 0.5);
      band = (pct(v, 0.98) - pct(v, 0.02)) * 0.5 + margin;
    }

    /* The flood stops one cell short of every edge it refused to cross, and
     * that last row is background too — the wall's final cells before the
     * hairline. Absorb the unclaimed cells that touch it and still sit inside
     * the tone band, once, so the silhouette lands on the edge rather than a
     * couple of cells outside it. */
    var fringe = [];
    for (i = 0; i < n; i++) {
      if (seen[i] || Math.abs(tn[i] - med) > band) continue;
      var ix = i % w, iy = (i / w) | 0;
      if ((ix > 0 && seen[i - 1]) || (ix < w - 1 && seen[i + 1]) ||
          (iy > 0 && seen[i - w]) || (iy < h - 1 && seen[i + w])) fringe.push(i);
    }
    for (i = 0; i < fringe.length; i++) seen[fringe[i]] = 1;

    var subject = new CD.Field(w, h, 1);
    var sm = subject.data;
    var area = 0;
    for (i = 0; i < n; i++) { sm[i] = seen[i] ? 0 : 1; area += sm[i]; }

    var frac = area / n;
    if (frac < 0.004 || frac > 0.985) return null;   // nothing, or everything

    /* Heal the wedges the flood pushes in wherever subject and background
     * happen to share a tone. Four cells on a 420-cell grid is about one per
     * cent of the frame: enough to reconnect a neck the flood cut through,
     * too little to round off anything that is really part of the outline. */
    subject = CD.closeMask(subject, Math.max(2, Math.round(Math.min(w, h) * 0.012)));
    subject.blur(1, 1);
    return subject;
  }

  /* The silhouette the edge renderer traces.
   *
   * Kept separate from `dep.mask` on purpose: the surface renderer's mask is
   * v1's and stays untouched. This one is isolated to a single subject, has
   * enclosed holes filled — an eye socket dipping past the threshold would
   * otherwise grow its own set of contours — and is feathered a little harder,
   * because marching squares should not have to follow a stair-stepped edge.
   */
  function buildEdgeMask(mask, p) {
    var m = mask;
    if (p.isolateSubject) {
      /* Keep the main body and anything within reach of its size — a head cut
       * off its shoulders is still the subject — and drop the specks. */
      m = CD.mainRegions(m, 0.5, 0.12);
      m = CD.fillEnclosed(m, 0.5);
    } else {
      m = m.clone();
    }
    m.blur(2, 2);
    return m;
  }

  CD.buildDepth = buildDepth;
  CD.buildEdgeMask = buildEdgeMask;
  CD.subjectMask = subjectMask;
  CD.buildFlow = buildFlow;
  CD.dirAt = dirAt;
  CD.contrastCurve = contrastCurve;
})(CD);
