/* ============================================================================
 * edge.js — contours of the separation between subject and background.
 *
 * The whole renderer here rests on one field: the SIGNED DISTANCE to the
 * silhouette, positive inside the subject and negative out in the background.
 * Its zero level *is* the edge, and every other level is a clean parallel
 * offset from it, so "one contour" and "six contours stepping outward" are the
 * same operation at different levels rather than separate code paths.
 *
 * How many of those contours actually appear at a given place is decided by
 * the picture's own tonality: dark regions earn the full stack of bands and
 * read as shading, light regions keep only band 0 and read as a single line
 * tracing the subject. That is the gradient in the reference images — a lone
 * outline through the bright areas thickening into dense banding in the darks.
 * ==========================================================================*/
var CD = window.CD || {};

(function (CD) {
  'use strict';

  var clamp = CD.clamp;

  /* How many bands the tonality supports at this point. Band 0 is always
   * allowed, so the subject never loses its outline. */
  function makeBandLimit(tone, params) {
    var n = Math.max(1, Math.round(params.lineCount));
    var amount = clamp(params.shading, 0, 1);
    var falloff = Math.max(0.05, params.shadingFalloff);
    /* Scale by n, not n-1. Dividing the darkness range into (n-1) steps means
     * the outermost band only appears at darkness exactly 1 — pure black after
     * blur and contrast, which almost nothing is — so at two lines the second
     * one never showed at all. Scaling by n leaves headroom, so every band is
     * reachable within the tones a real photograph actually contains. */
    return function (fx, fy) {
      var darkness = 1 - clamp(tone.sample(fx, fy, 0), 0, 1);
      return 1 + n * amount * Math.pow(darkness, falloff);
    };
  }

  /* ctx: { dep, params, fieldScale }
   * Returns { lines: [{pts, band}], sd } with pts in view pixels. */
  function buildEdgeLines(ctx) {
    var dep = ctx.dep, p = ctx.params, s = ctx.fieldScale;

    var sd = CD.signedDistance(dep.mask, 0.5);

    var n = Math.max(1, Math.round(p.lineCount));
    var step = Math.max(0.4, p.lineSpacing * s);   // view px -> grid cells
    var spread = p.lineSpread;
    var lines = [];

    for (var k = 0; k < n; k++) {
      var off = k * step;
      var levels;
      if (k === 0) {
        levels = [0];                       // the silhouette itself
      } else if (spread === 'inside') {
        levels = [off];
      } else if (spread === 'outside') {
        levels = [-off];
      } else {
        levels = [off, -off];               // both ways off the edge
      }

      for (var li = 0; li < levels.length; li++) {
        var polys = CD.isoContours(sd, levels[li]);
        for (var q = 0; q < polys.length; q++) {
          var pts = polys[q];
          for (var m = 0; m < pts.length; m++) pts[m] /= s;   // grid -> view
          lines.push({ pts: pts, band: k });
        }
      }
    }

    return { lines: lines, sd: sd };
  }

  CD.buildEdgeLines = buildEdgeLines;
  CD.makeBandLimit = makeBandLimit;
})(CD);
