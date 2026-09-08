/* ============================================================================
 * matte.js — separating the subject from the ground.
 *
 * A brightness cutoff cannot do this job on a real photograph, and it is worth
 * being exact about why. It draws one line through the tones and calls
 * everything on one side "subject". That only works if the subject is entirely
 * brighter, or entirely darker, than the ground. A portrait against a mid-grey
 * wall is neither: the lit cheek is brighter than the wall and the hair and
 * the shirt are darker, so the subject sits on BOTH sides of it.
 *
 * Measured on exactly that plate, the best brightness cutoff available
 * anywhere scored 42% agreement with the true subject, and only reached that
 * by swallowing the whole background; a cutoff low enough to exclude the
 * background missed 93% of the person. What the modes then drew was the
 * light-and-shadow line across the face, not the outline of the person.
 *
 * So there are better sources, and this is where they live:
 *
 *   backplate  a second exposure of the empty set. The subject is wherever
 *              the two frames differ. Exact, free, needs no network, and it
 *              is the right answer whenever the ground can be photographed
 *              on its own.
 *   depth      the subject is nearer than the wall. Needs the depth model,
 *              but works from a single frame and does not care about tone.
 *   alpha      the file already carries its own outline.
 *   brightness the fallback, kept because it needs nothing.
 * ==========================================================================*/
var CD = window.CD || {};

(function (CD) {
  'use strict';

  var clamp = CD.clamp, smoothstep = CD.smoothstep;

  /* --------------------------------------------------------------------------
   * Backplate difference
   * ------------------------------------------------------------------------*/

  /* Coverage from two frames of the same set, one with the subject and one
   * without. Distance is measured in RGB rather than in luminance, so a
   * subject that merely differs in hue from the ground still separates —
   * which brightness alone would miss entirely.
   *
   * `tolerance` is how much the two frames may differ and still count as the
   * same: it has to clear the sensor noise and whatever moved between the two
   * exposures, and nothing more. */
  function backplateMatte(px, bg, n, tolerance, softness) {
    var a = new Float32Array(n);
    var t = clamp(tolerance === undefined ? 0.06 : tolerance, 0.005, 0.9);
    var soft = Math.max(0.005, softness === undefined ? 0.04 : softness);
    /* the longest possible distance in RGB, so `d` lands in 0..1 */
    var norm = 1 / (Math.sqrt(3) * 255);

    for (var i = 0; i < n; i++) {
      var k = i * 4;
      var dr = px[k] - bg[k], dg = px[k + 1] - bg[k + 1], db = px[k + 2] - bg[k + 2];
      var d = Math.sqrt(dr * dr + dg * dg + db * db) * norm;
      a[i] = smoothstep(t, t + soft, d);
    }
    return a;
  }

  /* --------------------------------------------------------------------------
   * Depth
   * ------------------------------------------------------------------------*/

  /* Coverage from a depth map: the subject is the near part. The cut is found
   * by Otsu on the depth histogram rather than asked for, because "near" and
   * "far" are a genuine two-class split in a portrait and the numbers mean
   * nothing to a person — a depth of 0.43 is not something anyone can judge.
   * `bias` nudges it when the automatic split sits wrong. */
  function depthMatte(depth, n, bias) {
    var hist = new Uint32Array(256), i;
    for (i = 0; i < n; i++) {
      hist[clamp(Math.round(depth[i] * 255), 0, 255)]++;
    }
    var cut = clamp(CD.Auto.otsu(hist, n) + (bias || 0), 0.02, 0.98);

    var a = new Float32Array(n);
    for (i = 0; i < n; i++) a[i] = smoothstep(cut - 0.04, cut + 0.04, depth[i]);
    return a;
  }

  /* --------------------------------------------------------------------------
   * How well did it work?
   * ------------------------------------------------------------------------*/

  /* A matte that is nearly all subject, or nearly none, is not a separation —
   * it is the tool failing quietly. Reporting it lets the panel say so
   * instead of letting the modes draw something meaningless. */
  function quality(coverage, n) {
    var on = 0, mid = 0;
    for (var i = 0; i < n; i++) {
      var v = coverage[i];
      if (v > 0.5) on++;
      if (v > 0.15 && v < 0.85) mid++;
    }
    var share = on / n;
    return {
      share: +share.toFixed(3),
      soft: +(mid / n).toFixed(3),
      usable: share > 0.03 && share < 0.9
    };
  }

  CD.Matte = {
    backplate: backplateMatte,
    fromDepth: depthMatte,
    quality: quality
  };
})(CD);
