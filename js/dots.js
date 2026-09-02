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

    var dots = [];
    var jitter = p.randomness;
    var spacingBase = Math.max(0.6, p.dotSpacing);
    var maxDots = p.maxDots;

    for (var li = 0; li < lines.length && dots.length < maxDots; li++) {
      var pts = lines[li];
      if (pts.length < 4) continue;

      var carry = rng() * spacingBase; // desync the phase of each line
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

          /* size: depth drives the base, size variation adds the scatter */
          var base = p.dotSize * lerp(0.22, 1.0, Math.pow(d, p.sizeFalloff));
          var vary = 1 + (rng() - 0.5) * 2 * p.sizeVariation;
          var size = base * vary;

          /* Local spacing: dots crowd together where the surface faces the
           * viewer. Near dots are also the biggest, so the step is floored at
           * a little over one diameter — otherwise the densest, largest dots
           * fuse into a solid line and the halftone reads as fill. */
          var localSpacing = spacingBase * lerp(1.5, 0.68, d);
          localSpacing *= 1 + (rng() - 0.5) * 2 * jitter * 0.6;
          localSpacing = Math.max(size * 2.15, localSpacing);

          if (m > 0.5 && size > 0.16) {
            /* rotation follows the contour */
            var dir = CD.dirAt(flow, fx, fy);
            var rot = Math.atan2(dir.y, dir.x);
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

            dots.push({ x: px, y: py, s: size, r: rot, d: d });
            if (dots.length >= maxDots) break;
          }
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
