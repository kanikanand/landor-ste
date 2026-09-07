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
  function buildDepth(px, w, h, p) {
    var i, n = w * h;
    var vals = new Float32Array(n);

    /* luminance -> depth. White is near, black is far, per the brief. */
    for (i = 0; i < n; i++) {
      var r = px[i * 4] / 255, g = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255;
      vals[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    return buildDepthFromValues(vals, w, h, p);
  }

  /* The depth pipeline proper, from a single-channel 0..1 grid in which 1 is
   * near and 0 is far — whether that came from luminance or from a depth
   * model. Everything downstream (gradient, flow, streamlines, dots) only ever
   * sees the result of this, so the two sources are interchangeable.
   *
   * `vals` is consumed; pass a copy if the caller still needs it.
   */
  function buildDepthFromValues(vals, w, h, p) {
    var i, x, y, n = w * h;
    var depth = new CD.Field(w, h, 1);
    var d = depth.data;

    /* 1. orientation. Invert when the subject reads dark-on-light. */
    for (i = 0; i < n; i++) {
      d[i] = p.invert ? 1 - vals[i] : vals[i];
    }

    /* 2. image-level contrast, before anything structural happens. */
    if (p.imageContrast !== 1) {
      for (i = 0; i < n; i++) d[i] = contrastCurve(d[i], p.imageContrast);
    }

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

    return { depth: depth, mask: mask, grad: grad, w: w, h: h };
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

  CD.buildDepth = buildDepth;
  CD.buildDepthFromValues = buildDepthFromValues;
  CD.buildFlow = buildFlow;
  CD.dirAt = dirAt;
  CD.contrastCurve = contrastCurve;
})(CD);
