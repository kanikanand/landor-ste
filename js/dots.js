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

  /* Coverage threshold a dot must clear. At full dissolve a dot survives on
   * almost nothing, because its size is being scaled away long before it gets
   * there; at zero the old hard half-coverage edge is back. */
  function gateFor(dissolve) {
    return 0.5 - 0.45 * clamp(dissolve || 0, 0, 1);
  }

  /* Size after the region edge has had its say. Inside the region coverage is
   * 1 and this does nothing; across a feathered edge it takes the dot down to
   * nothing, so the field thins out instead of stopping at a line.
   *
   * Coverage is remapped against the gate rather than used raw, so the dot
   * reaches zero exactly where it stops being drawn. Scaling by raw coverage
   * leaves the last row at a third of full size and the edge reads as a cut
   * after all — which is the whole thing this is here to avoid. */
  function dissolveSize(size, cov, dissolve, gate) {
    if (!(dissolve > 0)) return size;
    var k = clamp((cov - gate) / ((1 - gate) || 1), 0, 1);
    return size * lerp(1, k, clamp(dissolve, 0, 1));
  }

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
    var gate = gateFor(p.edgeDissolve);

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
          var size = dissolveSize(base * vary, m, p.edgeDissolve, gate);

          /* Local spacing: dots crowd together where the surface faces the
           * viewer. Near dots are also the biggest, so the step is floored at
           * a little over one diameter — otherwise the densest, largest dots
           * fuse into a solid line and the halftone reads as fill. */
          var localSpacing = spacingBase * lerp(1.5, 0.68, d);
          localSpacing *= 1 + (rng() - 0.5) * 2 * jitter * 0.6;
          localSpacing = Math.max(size * 2.15, localSpacing);

          if (m > gate && size > 0.16) {
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

  /* --------------------------------------------------------------------------
   * Grid fill
   *
   * The other way to fill a region: a regular lattice rather than dots strung
   * along contours. Rows read as a halftone where the surface is broad and
   * flat — the side of a hull, a panel — where contour bands have little to
   * follow and start to wander. Everything else is shared with the contour
   * fill: size, colour and relief come from depth, rotation from flow, so the
   * two modes sit in the same picture without disagreeing.
   *
   * Rows are offset half a step on alternate lines, which packs the lattice
   * hexagonally instead of leaving the aisles a square grid shows.
   * ------------------------------------------------------------------------*/
  function buildGridDots(ctx) {
    var depth = ctx.depth, grad = ctx.grad, mask = ctx.mask, flow = ctx.flow;
    var s = ctx.fieldScale;
    var p = ctx.params;
    var rng = ctx.rng;

    var dots = [];
    var jitter = p.randomness;
    var step = Math.max(1.2, p.dotSpacing);
    var rowStep = step * 0.866;                 // hexagonal packing
    var gate = gateFor(p.edgeDissolve);
    var maxDots = p.maxDots;

    /* The lattice runs at the base angle, so it lines up with the contour
     * fill's fallback direction rather than always sitting axis-aligned. */
    var a = (p.flowAngle || 0) * Math.PI / 180;
    var ca = Math.cos(a), sa = Math.sin(a);

    /* Cover the rotated bounding box of the view, so no corner is missed. */
    var w = ctx.viewW, h = ctx.viewH;
    var reach = Math.ceil(Math.hypot(w, h) * 0.5) + step;
    var cx = w * 0.5, cy = h * 0.5;
    var rows = Math.ceil((reach * 2) / rowStep);
    var cols = Math.ceil((reach * 2) / step);

    for (var r = 0; r <= rows && dots.length < maxDots; r++) {
      var v = -reach + r * rowStep;
      var rowShift = (r & 1) ? step * 0.5 : 0;

      for (var c = 0; c <= cols; c++) {
        var u = -reach + c * step + rowShift;

        /* lattice space -> view space */
        var x = cx + u * ca - v * sa;
        var y = cy + u * sa + v * ca;
        if (x < -step || y < -step || x > w + step || y > h + step) continue;

        var fx = x * s, fy = y * s;
        var m = mask.sample(fx, fy, 0);
        if (m <= gate) continue;

        var d = depth.sample(fx, fy, 0);
        var base = p.dotSize * lerp(0.22, 1.0, Math.pow(d, p.sizeFalloff));
        var vary = 1 + (rng() - 0.5) * 2 * p.sizeVariation;
        var size = dissolveSize(base * vary, m, p.edgeDissolve, gate);
        if (size <= 0.16) continue;

        var dir = CD.dirAt(flow, fx, fy);
        var rot = Math.atan2(dir.y, dir.x) + (rng() - 0.5) * 2 * jitter * 0.9;

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
        if (jitter > 0) {
          px += (rng() - 0.5) * 2 * jitter * step * 0.5;
          py += (rng() - 0.5) * 2 * jitter * step * 0.5;
        }

        dots.push({ x: px, y: py, s: size, r: rot, d: d });
        if (dots.length >= maxDots) break;
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

  CD.gateFor = gateFor;
  CD.buildDots = buildDots;
  CD.buildGridDots = buildGridDots;
  CD.makeRamp = makeRamp;
  CD.hexToRgb = hexToRgb;
  CD.rgbToHex = rgbToHex;
})(CD);
