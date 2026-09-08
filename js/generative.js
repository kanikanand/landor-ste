/* ============================================================================
 * generative.js — the field with no photograph behind it.
 *
 * For the Concepts category the dots are not describing something else; they
 * are the image. That is a primary expression, not what happens when there is
 * no picture available, so it needs its own construction rather than a
 * photograph's pipeline run on an empty frame.
 *
 * The construction is a height field, exactly like a depth map, so everything
 * downstream — contours, spacing, size, colour, the region — works unchanged.
 * What differs is where the height comes from: a focal point, a direction,
 * and a star geometry, combined so that one clear transformation reads across
 * the frame.
 *
 *   CONVERGENCE   height rises towards the focal point, so contours close in
 *                 around it. Reads as collaboration, or arrival.
 *   ALIGNMENT     height is a plane running along the direction, so contours
 *                 are parallel. Reads as precision.
 *   EXPANSION     height falls away from the focal point, so contours open
 *                 outwards. Reads as possibility.
 *
 * `converge` runs between expansion at 0 and convergence at 1, with alignment
 * in the middle, which is why it is a single control: they are three points on
 * one axis, not three separate settings.
 *
 * A NOTE ON THE STAR. The organising geometry here is a parametric N-pointed
 * star, because the real mark's construction is not in this repository. It is
 * a stand-in with the right behaviour — an N-fold symmetry that the field
 * resolves towards — and it should be replaced by the actual logo geometry
 * before this is used for anything real. The star is deliberately an
 * organising influence and a resolution point, never a shape scattered
 * through the pattern.
 * ==========================================================================*/
var CD = window.CD || {};

(function (CD) {
  'use strict';

  var clamp = CD.clamp, lerp = CD.lerp, smoothstep = CD.smoothstep;

  /* Signed distance to a regular N-pointed star, in normalised coordinates.
   * Positive inside. Used as an organising influence on the height, not drawn. */
  function starField(u, v, cx, cy, points, radius, rotation) {
    var dx = u - cx, dy = v - cy;
    var r = Math.hypot(dx, dy);
    if (r < 1e-6) return 1;
    var a = Math.atan2(dy, dx) - rotation;
    var seg = (Math.PI * 2) / points;
    /* fold the angle into one segment and measure across it */
    var t = a - seg * Math.round(a / seg);
    /* a star's radius swings between the point and the valley */
    var reach = radius * lerp(0.42, 1, Math.pow(Math.cos(t * points * 0.5), 2));
    return clamp(1 - r / Math.max(1e-4, reach), -1, 1);
  }

  /* Build the height field. Returns a Field(1ch) normalised to 0..1, ready to
   * be handed to the same depth pipeline a photograph would use. */
  function build(w, h, p) {
    var f = new CD.Field(w, h, 1), d = f.data;
    var cx = p.focusX === undefined ? 0.5 : p.focusX;
    var cy = p.focusY === undefined ? 0.45 : p.focusY;
    var ang = (p.fieldAngle === undefined ? 0 : p.fieldAngle) * Math.PI / 180;
    var ux = Math.cos(ang), uy = Math.sin(ang);
    var converge = clamp(p.converge === undefined ? 0.7 : p.converge, 0, 1);
    var points = Math.max(3, Math.round(p.starPoints || 5));
    var starAmt = clamp(p.starInfluence === undefined ? 0.45 : p.starInfluence, 0, 1);
    var reach = Math.max(0.05, p.focusReach === undefined ? 0.42 : p.focusReach);

    var i = 0;
    for (var y = 0; y < h; y++) {
      var v = (y + 0.5) / h;
      for (var x = 0; x < w; x++, i++) {
        var u = (x + 0.5) / w;

        /* radial term: 1 at the focal point, falling away */
        var r = Math.hypot((u - cx), (v - cy) * (h / w) * (w / h));
        var radial = 1 - smoothstep(0, reach * 1.8, r);

        /* directional term: a plane along the chosen angle */
        var plane = 0.5 + ((u - 0.5) * ux + (v - 0.5) * uy);

        /* Converge and expand are the same term with opposite sign, and
         * alignment is what is left when neither dominates — so one control
         * spans all three rather than three controls contradicting. */
        var pull = (converge - 0.5) * 2;              // -1 expand .. +1 converge
        var base = lerp(plane, radial, Math.abs(pull));
        if (pull < 0) base = lerp(plane, 1 - radial, -pull);

        /* the star resolves the field rather than decorating it */
        if (starAmt > 0) {
          var st = starField(u, v, cx, cy, points, reach, ang);
          base = lerp(base, clamp(base + st * 0.55, 0, 1), starAmt);
        }

        d[i] = clamp(base, 0, 1);
      }
    }

    /* A little smoothing so the contours are continuous, the same reason a
     * photograph needs it. */
    f.blur(Math.max(1, Math.round(Math.min(w, h) / 90)), 2);

    /* renormalise, so intensity and colour read the full range whatever the
     * combination of terms happened to produce */
    var lo = Infinity, hi = -Infinity, n = w * h;
    for (i = 0; i < n; i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
    var span = (hi - lo) || 1;
    for (i = 0; i < n; i++) d[i] = (d[i] - lo) / span;

    return f;
  }

  CD.Generative = { build: build, starField: starField };
})(CD);
