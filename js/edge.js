/* ============================================================================
 * edge.js — the one line where the subject leaves the background.
 *
 * Everything here rests on the SIGNED DISTANCE to the silhouette, positive
 * inside the subject and negative out in the background. Its zero level *is*
 * the edge, so the contour comes out of the field directly rather than being
 * chased around the mask pixel by pixel, and it comes out closed and ordered,
 * which is what the dot walker needs.
 *
 * Only that zero level is drawn. Offset bands stepping away from the edge
 * were a way of shading the darks, and shading is the surface renderer's job;
 * an edge is a single line around the subject or it is not an edge.
 * ==========================================================================*/
var CD = window.CD || {};

(function (CD) {
  'use strict';

  /* ctx: { mask, fieldScale }
   * Returns { lines: [{pts}], sd } with pts in view pixels. */
  function buildEdgeLines(ctx) {
    var s = ctx.fieldScale;
    var sd = CD.signedDistance(ctx.mask, 0.5);

    var polys = CD.isoContours(sd, 0);
    var lines = [];
    for (var q = 0; q < polys.length; q++) {
      var pts = polys[q];
      for (var m = 0; m < pts.length; m++) pts[m] /= s;   // grid -> view
      lines.push({ pts: pts });
    }

    return { lines: lines, sd: sd };
  }

  CD.buildEdgeLines = buildEdgeLines;
})(CD);
