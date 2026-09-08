/* ============================================================================
 * auto.js — reading the picture, so the picture does not have to be read by
 * hand.
 *
 * Roughly a third of the control panel is not aesthetic at all. Polarity,
 * where the background ends, how far the subject's tones actually span, how
 * much of the fine detail is noise rather than form — those have correct
 * answers for a given image, and the answers are recoverable from the image.
 * Leaving them as sliders means every new plate starts by rediscovering them,
 * and getting one wrong makes every downstream control misbehave.
 *
 * What is deliberately NOT here: dot size, spacing, colour, fill mode, where
 * the wipe sits. Those are choices, not measurements, and automating a choice
 * only takes it away.
 *
 * The split matters architecturally too — auto owns the image parameters and
 * the presets own the look parameters, the two sets are disjoint, so a mode
 * and a plate can be changed independently without either clobbering the
 * other.
 * ==========================================================================*/
var CD = window.CD || {};

(function (CD) {
  'use strict';

  var clamp = CD.clamp;

  /* Which parameters auto owns. Everything else is left alone. */
  var OWNED = ['invert', 'maskThreshold', 'maskDespeckle', 'maskSmoothing',
               'exposure', 'imageContrast', 'depthContrast', 'threshold',
               'depthSmoothing', 'flowSmoothing', 'reliefCoherence'];

  /* --------------------------------------------------------------------------
   * Small statistics
   * ------------------------------------------------------------------------*/

  function quantile(sorted, q) {
    if (!sorted.length) return 0;
    var i = clamp(Math.floor(sorted.length * q), 0, sorted.length - 1);
    return sorted[i];
  }

  /* Median absolute deviation, the robust spread: unlike a standard deviation
   * it is not dragged around by the subject when we want to describe the
   * background, or by a specular highlight when we want to describe noise. */
  function mad(values, med) {
    var d = new Float64Array(values.length), i;
    for (i = 0; i < values.length; i++) d[i] = Math.abs(values[i] - med);
    var s = Array.prototype.slice.call(d).sort(function (a, b) { return a - b; });
    return quantile(s, 0.5);
  }

  /* Otsu's threshold: the split that minimises the variance within the two
   * sides. It is the right tool when the plate really is subject-against-
   * ground, and it does not care what the levels happen to be. */
  function otsu(hist, total) {
    var sum = 0, i;
    for (i = 0; i < 256; i++) sum += i * hist[i];
    var sumB = 0, wB = 0, best = 0, bestVar = -1;
    for (i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      var wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sum - sumB) / wF;
      var between = wB * wF * (mB - mF) * (mB - mF);
      if (between > bestVar) { bestVar = between; best = i; }
    }
    return best / 255;
  }

  /* --------------------------------------------------------------------------
   * The measurements
   * ------------------------------------------------------------------------*/

  /* Luminance, plus the border and the histogram, in one pass. */
  function survey(px, w, h) {
    var n = w * h;
    var lum = new Float32Array(n);
    var hist = new Uint32Array(256);
    var border = [];
    var bw = Math.max(2, Math.round(Math.min(w, h) * 0.06));

    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        var v = 0.2126 * (px[i * 4] / 255) +
                0.7152 * (px[i * 4 + 1] / 255) +
                0.0722 * (px[i * 4 + 2] / 255);
        lum[i] = v;
        hist[clamp(Math.round(v * 255), 0, 255)]++;
        if (x < bw || y < bw || x >= w - bw || y >= h - bw) border.push(v);
      }
    }
    border.sort(function (a, b) { return a - b; });
    return { lum: lum, hist: hist, border: border, n: n };
  }

  /* Noise, estimated the standard robust way: a Laplacian kills any smooth
   * signal, so what survives is grain and compression edges, and the median
   * of that is not moved by the handful of genuine edges in the picture.
   * Returned in units of image level, so 0.01 is a clean render and 0.06 is a
   * plate that will shatter contours if it is not smoothed. */
  function noiseLevel(lum, w, h) {
    var vals = [], step = Math.max(1, Math.round(Math.min(w, h) / 200));
    for (var y = 1; y < h - 1; y += step) {
      for (var x = 1; x < w - 1; x += step) {
        var i = y * w + x;
        var lap = 4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - w] - lum[i + w];
        vals.push(Math.abs(lap));
      }
    }
    vals.sort(function (a, b) { return a - b; });
    /* 1.4826 makes the median absolute deviation match a standard deviation
     * for gaussian noise; sqrt(20) is the Laplacian kernel's gain on it. */
    return quantile(vals, 0.5) * 1.4826 / Math.sqrt(20);
  }

  /* --------------------------------------------------------------------------
   * The tuner
   * ------------------------------------------------------------------------*/

  /* Returns a partial parameter object: only what auto owns. `alpha` is the
   * image's own coverage when it has one, in which case the silhouette is
   * already known and the threshold work is skipped. */
  function tune(px, w, h, alpha) {
    var s = survey(px, w, h);
    var lum = s.lum, n = s.n;

    /* 1. POLARITY. The border is background by construction; if it is lighter
     *    than the middle of the frame, the subject is dark on light and every
     *    near/far reading downstream is upside down. */
    var borderMed = quantile(s.border, 0.5);
    var mid = [], mw = Math.round(w * 0.25), mh = Math.round(h * 0.25);
    for (var y = mh; y < h - mh; y += 2) {
      for (var x = mw; x < w - mw; x += 2) mid.push(lum[y * w + x]);
    }
    mid.sort(function (a, b) { return a - b; });
    var midMed = quantile(mid, 0.5);
    var invert = borderMed > midMed;

    var orient = function (v) { return invert ? 1 - v : v; };
    var bgMed = orient(borderMed);
    var bgSpread = mad(s.border, borderMed);

    /* 2. NOISE, as it stands in the plate. What matters downstream is not
     *    this figure but this figure after the contrast curve has multiplied
     *    it, so the smoothing decision waits until contrast is known. */
    var noise = noiseLevel(lum, w, h);

    /* 3. WHERE THE BACKGROUND ENDS. Two independent readings, and the higher
     *    wins: the border tells us what the ground actually looks like
     *    including its noise, and Otsu tells us where the plate's own
     *    histogram splits. Border statistics alone fail when the subject
     *    runs off the edge of the frame; Otsu alone fails on a plate that is
     *    mostly background. */
    var maskThreshold;
    if (alpha) {
      maskThreshold = 0.06;      // unused; the alpha channel is the silhouette
    } else {
      var hist = s.hist;
      if (invert) {
        var flipped = new Uint32Array(256);
        for (var k = 0; k < 256; k++) flipped[255 - k] = hist[k];
        hist = flipped;
      }
      var byOtsu = otsu(hist, n);
      var byBorder = bgMed + 4 * bgSpread + noise;
      maskThreshold = clamp(Math.max(byBorder, byOtsu * 0.55), 0.01, 0.6);
    }

    /* 4. THE SUBJECT'S OWN TONAL RANGE. Contrast is set so that range fills
     *    the field, whatever the exposure: an underlit plate and a blown one
     *    both arrive at the dot stage looking the same. */
    var inside = [];
    for (var i = 0; i < n; i += 3) {
      var v = orient(lum[i]);
      var isSubject = alpha ? alpha[i] > 0.5 : v > maskThreshold;
      if (isSubject) inside.push(v);
    }
    inside.sort(function (a, b) { return a - b; });

    var lo = inside.length ? quantile(inside, 0.02) : 0;
    var hi = inside.length ? quantile(inside, 0.98) : 1;
    var range = Math.max(0.05, hi - lo);

    /* Centre the subject on the contrast curve's pivot first. Without this a
     * subject sitting low in the range is pushed lower as it is stretched and
     * its shadow end clips flat. */
    var exposure = clamp(0.5 - (lo + hi) * 0.5, -0.45, 0.45);
    var imageContrast = clamp(1 / range, 0.5, 3.2);
    var depthContrast = clamp(1.2 + (1 - clamp(range, 0, 1)) * 0.8, 1, 2);

    /* Centred and stretched, the subject's low end lands near zero by
     * construction, so the floor only has to clear the last of the falloff. */
    var threshold = clamp(0.5 - 0.5 * range * imageContrast + 0.03, 0, 0.5);

    /* 5. SMOOTHING, all three radii from one number — but the right number
     *    is the noise as the flow field will see it, not as it arrives.
     *
     *    Contrast multiplies noise along with signal, so an underexposed
     *    plate stretched by 2 has twice the grain in its gradient even though
     *    the raw reading looked clean. Measured before this was accounted
     *    for, the underexposed case came out at a third the strand length of
     *    every other plate: auto was setting clean-render smoothing on a
     *    field it had just amplified.
     *
     *    Eight-bit quantisation sets the floor. A perfectly clean render
     *    still steps by 1/255, and stretched hard enough that step is a
     *    visible terrace in the gradient. */
    var quantum = 1 / 255;
    var effective = Math.max(noise, quantum) * imageContrast * depthContrast;

    /* Despeckle is the cheap one and does most of the work, so it moves first
     * and hardest; depth and flow smoothing cost real structure, so they stay
     * near their clean-plate values until the grain justifies them. The
     * floors are what a clean render needs; the ceilings stop a very dirty
     * plate from being smoothed into a blank. */
    var grit = clamp(effective / 0.05, 0, 1.6);   // 0 clean, 1 low-quality
    var maskDespeckle = Math.round(clamp(1 + grit * 3.5, 1, 6));
    var depthSmoothing = Math.round(clamp(3 + grit * 9, 3, 18));
    var flowSmoothing = Math.round(clamp(2 + grit * 5, 2, 10));

    return {
      invert: invert,
      maskThreshold: +maskThreshold.toFixed(3),
      maskDespeckle: maskDespeckle,
      maskSmoothing: alpha ? 0 : Math.round(clamp(grit * 1.5, 0, 2)),
      exposure: +exposure.toFixed(3),
      imageContrast: +imageContrast.toFixed(2),
      depthContrast: +depthContrast.toFixed(2),
      threshold: +threshold.toFixed(3),
      depthSmoothing: depthSmoothing,
      flowSmoothing: flowSmoothing,
      reliefCoherence: Math.round(clamp(8 + grit * 6, 8, 16)),

      /* reported, not applied — the panel shows what was read */
      _noise: +noise.toFixed(4),
      _effective: +effective.toFixed(4),
      _grit: +grit.toFixed(2),
      _bg: +bgMed.toFixed(3),
      _range: +range.toFixed(3)
    };
  }

  CD.Auto = { tune: tune, OWNED: OWNED, noiseLevel: noiseLevel, otsu: otsu };
})(CD);
