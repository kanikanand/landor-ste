/* ============================================================================
 * dots.js — turning contour streamlines into oriented dots.
 *
 * Walks each streamline by arc length and emits a dot every `dotSpacing`
 * pixels, where the spacing, the size and the colour are all read from the
 * DEPTH field, and the rotation is read from the FLOW field:
 *
 *     rotation = atan2(flow.y, flow.x)
 *
 * Depth exaggeration displaces each dot along the depth gradient (the surface
 * normal projected into the picture plane). That relief shift is what makes
 * the bands read as a form bulging towards the viewer rather than as a flat
 * contour map.
 * ==========================================================================*/
var CD = window.CD || {};

(function (CD) {
  'use strict';

  var clamp = CD.clamp, lerp = CD.lerp;

  /* Each dot: {x, y, s (radius in px), r (radians), d (depth 0..1)} */
  function buildDots(ctx) {
    var lines = ctx.lines;
    var depth = ctx.depth, grad = ctx.grad, mask = ctx.mask, flow = ctx.flow;
    var s = ctx.fieldScale;
    var p = ctx.params;
    var rng = ctx.rng;

    /* Where a mark is allowed to exist. The surface renderer has always
     * asked the silhouette mask; the edge and fingerprint renderers answer it
     * differently, so they pass their own test in. */
    var gate = ctx.gate || null;

    /* Node + link: shape 1 lands every Nth step along the line, shape 2 fills
     * the run between.
     *
     * It is a *labelling* of the walk, never a change to it. The walk below is
     * v1's, arithmetic for arithmetic and random draw for random draw, and
     * node/link only decides which shape each dot is drawn with and how big
     * the marked ones come out. Earlier it also started every line on a node,
     * skipped links that fell too near one, and fed the enlarged node size
     * back into the spacing floor — three things that each moved every dot
     * downstream of them, so surface mode stopped being v1. Now Node scale
     * changes what a dot looks like and nothing about where it lands. */
    var pairMode = p.shapeType === 'nodes';
    var nodeEvery = Math.max(1, Math.round(p.nodeEvery));
    var nodeScale = Math.max(0.1, p.nodeScale);

    var dots = [];
    var jitter = p.randomness;
    var spacingBase = Math.max(0.6, p.dotSpacing);
    var maxDots = p.maxDots;

    for (var li = 0; li < lines.length && dots.length < maxDots; li++) {
      var line = lines[li];
      var pts = line.pts;
      /* An extracted contour — an edge or a fingerprint ridge — is a mark on
       * a line in the picture plane, not a reading of a surface, so it is
       * evenly spaced and evenly sized along its whole length. Surface
       * streamlines take spacing, size and colour from depth, as they always
       * have. */
      var flat = line.kind === 'edge' || line.kind === 'fingerprint';
      if (!pts || pts.length < 4) continue;

      /* Each line starts on a random phase so the dots do not comb into rows
       * across neighbouring lines. */
      var carry = rng() * spacingBase;
      var idx = 0;                 // step count along this line

      for (var i = 0; i < pts.length - 2; i += 2) {
        var ax = pts[i], ay = pts[i + 1];
        var bx = pts[i + 2], by = pts[i + 3];
        var segX = bx - ax, segY = by - ay;
        var segLen = Math.hypot(segX, segY);
        if (segLen < 1e-6) continue;
        var ux = segX / segLen, uy = segY / segLen;

        var t = carry;
        while (t < segLen) {
          var x = ax + ux * t, y = ay + uy * t;
          var fx = x * s, fy = y * s;
          var m = mask.sample(fx, fy, 0);
          var d = depth.sample(fx, fy, 0);

          /* Size: on a surface streamline depth drives the base and size
           * variation adds the scatter. A flat contour takes one size along
           * its whole length — otherwise its marks vanish exactly where the
           * references put the most of them, in the darks. */
          var base = flat
            ? p.dotSize
            : p.dotSize * lerp(0.22, 1.0, Math.pow(d, p.sizeFalloff));
          var vary = 1 + (rng() - 0.5) * 2 * p.sizeVariation;
          var size = base * vary;

          /* Local spacing: dots crowd together where the surface faces the
           * viewer. Near dots are also the biggest, so the step is floored at
           * a little over one diameter — otherwise the densest, largest dots
           * fuse into a solid line and the halftone reads as fill. */
          var localSpacing = flat
            ? spacingBase
            : spacingBase * lerp(1.5, 0.68, d);
          localSpacing *= 1 + (rng() - 0.5) * 2 * jitter * 0.6;
          localSpacing = Math.max(size * 2.15, localSpacing);

          /* The step is now fixed. Everything after this point decides what
           * the dot looks like, never where the next one falls — the enlarged
           * node is carried separately so it cannot reach back into the
           * spacing floor or into the too-small test below, both of which are
           * v1's and answer about v1's dot. */
          var role = null, mark = size;
          if (pairMode) {
            if (idx % nodeEvery === 0) { role = 'node'; mark = size * nodeScale; }
            else { role = 'link'; }
          }

          var alive = gate ? gate(fx, fy) : (m > 0.5);

          if (alive && size > 0.16) {
            /* Rotation follows the contour. With a flow field that is the
             * field direction; on an extracted iso-line there is no field, so
             * it is the line's own tangent — the same thing measured
             * directly. */
            var rot;
            if (flow && !flat) {
              var dir = CD.dirAt(flow, fx, fy);
              rot = Math.atan2(dir.y, dir.x);
            } else {
              rot = Math.atan2(uy, ux);
            }
            rot += (rng() - 0.5) * 2 * jitter * 0.9;

            /* relief displacement along the depth gradient */
            var px = x, py = y;
            if (p.depthExaggeration > 0.001) {
              var gx = grad.sample(fx, fy, 0), gy = grad.sample(fx, fy, 1);
              var gl = Math.hypot(gx, gy);
              if (gl > 1e-5) {
                var amt = p.depthExaggeration * Math.min(1, gl * 14);
                px += (gx / gl) * amt;
                py += (gy / gl) * amt;
              }
            }

            /* positional randomness, perpendicular to the contour so the
             * lines stay legible as lines */
            if (jitter > 0) {
              var jn = (rng() - 0.5) * 2 * jitter * localSpacing * 0.55;
              px += -uy * jn;
              py += ux * jn;
              var jt = (rng() - 0.5) * 2 * jitter * localSpacing * 0.35;
              px += ux * jt; py += uy * jt;
            }

            /* Colour comes off the depth ramp, which is right for a dot
             * lying on the surface. A flat contour is not on the surface, so
             * it takes the near end of the ramp and holds one colour along
             * its whole length instead of sinking into the background. */
            var tint = flat ? 1 : d;

            dots.push({ x: px, y: py, s: mark, r: rot, d: tint, role: role });
            if (dots.length >= maxDots) break;
          }
          idx++;
          t += localSpacing;
        }
        carry = t - segLen;
      }
    }

    return dots;
  }

  /* Depth -> colour ramp. Far end of the surface sits close to the background
   * so the form fades out instead of ending on a hard edge. */
  function makeRamp(farHex, nearHex) {
    var f = hexToRgb(farHex), n = hexToRgb(nearHex);
    return function (d, gamma) {
      var t = Math.pow(clamp(d, 0, 1), gamma || 1);
      return [
        Math.round(lerp(f[0], n[0], t)),
        Math.round(lerp(f[1], n[1], t)),
        Math.round(lerp(f[2], n[2], t))
      ];
    };
  }

  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var v = parseInt(h, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  function rgbToHex(c) {
    return '#' + ((1 << 24) + (c[0] << 16) + (c[1] << 8) + c[2]).toString(16).slice(1);
  }

  CD.buildDots = buildDots;
  CD.makeRamp = makeRamp;
  CD.hexToRgb = hexToRgb;
  CD.rgbToHex = rgbToHex;
})(CD);
