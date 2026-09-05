/* ============================================================================
 * fingerprint.js — ridges in the ground the subject stands against.
 *
 * A fingerprint is not a field of scattered marks; it is a set of continuous
 * ridges that never cross each other, run roughly parallel, and bend around
 * whatever is in their way. That is exactly the description of the iso-lines
 * of a scalar field, so the ridges are extracted rather than drawn:
 *
 *     phi = signedDistance(subject) + swirl * noise
 *
 * The distance term alone gives clean offsets of the silhouette — rings
 * around the head, which is the "bends around whatever is in their way"
 * half. The noise term warps them into the whorls and deltas that make it
 * read as a fingerprint rather than as a contour map, without ever letting
 * two ridges touch: they are level sets of one function, so they cannot.
 *
 * Only the background side is kept. The subject is left alone — the
 * photograph is what is there.
 * ==========================================================================*/
var CD = window.CD || {};

(function (CD) {
  'use strict';

  var MAX_RIDGES = 260;

  /* ctx: { mask, params, fieldScale, noise2D }
   * Returns { lines: [{pts}], sd } with pts in view pixels. */
  function buildFingerprintLines(ctx) {
    var p = ctx.params, s = ctx.fieldScale;
    var sd = CD.signedDistance(ctx.mask, 0.5);
    var w = sd.w, h = sd.h, n = w * h;

    var step = Math.max(1.2, p.ridgeSpacing * s);        // view px -> grid cells
    var swirl = Math.max(0, p.swirl);

    /* The warp is measured in ridge widths, so turning Swirl up bends the
     * ridges further without also changing how far apart they sit. */
    var amp = swirl * step * 1.35;
    /* One noise lobe every few ridges, not every ridge. A whorl is a slow
     * bend shared by a whole run of neighbouring ridges; noise at the ridge's
     * own frequency just breaks them into islands. */
    var scale = 0.26 / step;

    var phi = new CD.Field(w, h, 1);
    var pd = phi.data, sdd = sd.data;
    var lo = Infinity;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        var v = sdd[i];
        if (amp > 0) {
          /* two octaves: the first sets the whorl, the second roughens it */
          var a = ctx.noise2D(x * scale, y * scale) - 0.5;
          var b = ctx.noise2D(x * scale * 2.7 + 31.7, y * scale * 2.7 + 11.3) - 0.5;
          v += amp * (a * 2 + b * 0.7);
        }
        pd[i] = v;
        if (v < lo) lo = v;
      }
    }

    /* Ridges only outside the subject, walking outward from the silhouette
     * until the field runs out. */
    var lines = [];
    var count = Math.min(MAX_RIDGES, Math.ceil((0 - lo) / step) + 1);
    for (var k = 1; k <= count; k++) {
      var polys = CD.isoContours(phi, -k * step);
      for (var q = 0; q < polys.length; q++) {
        var pts = polys[q];
        for (var m = 0; m < pts.length; m++) pts[m] /= s;
        lines.push({ pts: pts });
      }
    }

    return { lines: lines, sd: sd };
  }

  CD.buildFingerprintLines = buildFingerprintLines;
})(CD);
