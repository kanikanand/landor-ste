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

  /* --------------------------------------------------------------------------
   * One signal, three channels.
   *
   * Depth is a single number, and there are three ways to spend it: the dot's
   * size, its colour and its opacity. Spending all three at once — which is
   * what happens when they all read depth at full strength — saturates. Near
   * dots come out big AND bright AND solid, far ones disappear on every axis
   * at the same rate, and everything between flattens into the ends.
   *
   * Giving each channel its own amount is what lets depth read as colour over
   * dots of one size, or as size in one flat colour, or any mix of the two.
   * At amounts 1 / 1 / 0 this is exactly the old behaviour.
   * ------------------------------------------------------------------------*/
  function amount(v, dflt) {
    return clamp(v === undefined ? dflt : v, 0, 1);
  }

  /* Interpolate, but return the endpoints exactly. lerp(1, v, 1) is v to
   * within a rounding error, and a rounding error is enough to move a dot
   * across a colour-bucket boundary — so at full strength the channel hands
   * back the value untouched and the default path stays identical to the one
   * before the channels existed. */
  function blend(base, v, amt) {
    if (amt >= 1) return v;
    if (amt <= 0) return base;
    return lerp(base, v, amt);
  }

  /* Written into a scratch object rather than returned fresh, because this
   * runs for every candidate position — including the many that are rejected
   * before a dot is ever built. The result must be consumed before the next
   * call: do not hold on to it. */
  var CH = { scale: 1, c: 1, a: 1 };

  function channels(d, tone, p) {
    var dc = clamp(d, 0, 1);

    /* size: the old curve, faded towards uniform as the amount drops */
    var k = Math.pow(dc, p.sizeFalloff);
    CH.scale = blend(1, lerp(0.22, 1.0, k), amount(p.sizeDepth, 1));

    /* colour: from depth, or from the picture's own tone when asked, faded
     * towards the near colour as the amount drops */
    var base = (p.tintFromImage && tone !== undefined) ? clamp(tone, 0, 1) : dc;
    CH.c = blend(1, base, amount(p.colorDepth, 1));

    /* opacity: off by default, because it is the channel that most easily
     * turns a halftone into haze */
    CH.a = blend(1, dc, amount(p.fadeDepth, 0));
    return CH;
  }

  /* Coverage threshold a dot must clear. At full dissolve a dot survives on
   * almost nothing, because its size is being scaled away long before it gets
   * there; at zero the old hard half-coverage edge is back. */
  /* Smallest dot worth drawing, relative to the dot size rather than a fixed
   * 0.16px: an absolute floor quietly culls a large share of a fine-grained
   * render and none of a coarse one, which reads as the fine settings simply
   * losing coverage. */
  function minSizeFor(p) {
    return Math.min(0.16, p.dotSize * 0.07);
  }

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

  /* Each dot: {x, y, s (radius in px), r (radians), d (depth 0..1),
   *             c (colour parameter 0..1), a (opacity 0..1),
   *             li (which row it belongs to, so the row can be drawn as a
   *                 line through its own dots)} */
  function buildDots(ctx) {
    var lines = ctx.lines;
    var depth = ctx.depth, grad = ctx.grad, mask = ctx.mask, flow = ctx.flow;
    var tone = ctx.tone, relief = ctx.relief;
    var s = ctx.fieldScale;
    var p = ctx.params;
    var rng = ctx.rng;

    var dots = [];
    var jitter = p.randomness;
    var spacingBase = Math.max(0.6, p.dotSpacing);
    var maxDots = p.maxDots;
    var gate = gateFor(p.edgeDissolve);
    var along = amount(p.jitterAlong, 0.75);
    var density = amount(p.densityDepth, 1);
    var minSize = minSizeFor(p);
    var rowAlign = amount(p.rowAlign, 0);
    var rowA = (p.flowAngle || 0) * Math.PI / 180;
    var rowCa = Math.cos(rowA), rowSa = Math.sin(rowA);

    for (var li = 0; li < lines.length && dots.length < maxDots; li++) {
      var pts = lines[li];
      if (pts.length < 4) continue;

      /* Where the first dot of this line falls.
       *
       * A random phase per line desynchronises them, which reads as organic
       * banding — dots strung along each contour independently. Locking the
       * phase to a global ruler instead lines the dots up across neighbouring
       * contours as well as along them, and the field stops reading as bands
       * of dots and starts reading as a lattice lying on the surface, which
       * is the look of a panelled hull or a wing. Row align blends the two;
       * the residue at partial values is a jitter about the locked phase
       * rather than an interpolation between two unrelated numbers. */
      var carry;
      if (rowAlign > 0) {
        var q = pts[0] * rowCa + pts[1] * rowSa;
        var locked = (((-q) % spacingBase) + spacingBase) % spacingBase;
        var wobble = (rng() - 0.5) * spacingBase * (1 - rowAlign);
        carry = ((locked + wobble) % spacingBase + spacingBase) % spacingBase;
      } else {
        carry = rng() * spacingBase; // desync the phase of each line
      }
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
          var ch = channels(d, tone ? tone.sample(fx, fy, 0) : undefined, p);

          /* size: the depth channel drives the base, size variation scatters it */
          var vary = 1 + (rng() - 0.5) * 2 * p.sizeVariation;
          var size = dissolveSize(p.dotSize * ch.scale * vary, m, p.edgeDissolve, gate);

          /* Local spacing: dots crowd together where the surface faces the
           * viewer. Near dots are also the biggest, so the step is floored at
           * a little over one diameter — otherwise the densest, largest dots
           * fuse into a solid line and the halftone reads as fill. */
          var localSpacing = spacingBase *
            lerp(1, lerp(1.5, 0.68, d), density);
          localSpacing *= 1 + (rng() - 0.5) * 2 * jitter * 0.6;
          localSpacing = Math.max(size * 2.15, localSpacing);

          if (m > gate && size > minSize && ch.a >= 0.02) {
            /* rotation follows the contour */
            var dir = CD.dirAt(flow, fx, fy);
            var rot = Math.atan2(dir.y, dir.x);
            rot += (rng() - 0.5) * 2 * jitter * 0.9;

            /* relief displacement, read from the smoothed relief field so
             * that neighbouring dots on one contour move together */
            var px = x, py = y;
            if (p.depthExaggeration > 0.001 && relief) {
              px += relief.sample(fx, fy, 0) * p.depthExaggeration;
              py += relief.sample(fx, fy, 1) * p.depthExaggeration;
            }

            /* Positional randomness, split between running along the contour
             * and across it. Along is nearly free — sliding a dot forwards
             * on the line it is already drawing does not disturb the line at
             * all — while across is precisely what breaks it up. The old
             * split put the larger share across, which is why randomness cost
             * so much legibility: at the default it more than doubled the
             * measured wobble of a line. Jitter along now decides the split,
             * and favours along. */
            if (jitter > 0) {
              var spread = jitter * localSpacing * 0.6;
              var rPerp = (rng() - 0.5) * 2 * spread * (1 - along);
              var rTan = (rng() - 0.5) * 2 * spread * along;
              px += -uy * rPerp + ux * rTan;
              py += ux * rPerp + uy * rTan;
            }

            dots.push({ x: px, y: py, s: size, r: rot, d: d, c: ch.c, a: ch.a, li: li });
            if (dots.length >= maxDots) break;
          }
          t += localSpacing;
        }
        carry = t - segLen;
      }
    }

    return dots;
  }


  /* Canvas and SVG must bucket identically or the export stops matching what
   * you saw, so the scheme lives here and both call it. Colour keeps the old
   * floor-into-N scheme; opacity is rounded onto the endpoints so 1 stays 1. */
  var COLOR_BUCKETS = 32, ALPHA_BUCKETS = 8;

  function bucketOf(dot, cb, ab) {
    var c = dot.c === undefined ? dot.d : dot.c;
    var a = dot.a === undefined ? 1 : dot.a;
    var ci = Math.floor(clamp(c, 0, 1) * cb);
    if (ci > cb - 1) ci = cb - 1;
    if (ci < 0) ci = 0;
    var ai = Math.round(clamp(a, 0, 1) * (ab - 1));
    return ci * ab + ai;
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

  CD.COLOR_BUCKETS = COLOR_BUCKETS;
  CD.ALPHA_BUCKETS = ALPHA_BUCKETS;
  CD.bucketOf = bucketOf;
  CD.gateFor = gateFor;
  CD.channels = channels;
  CD.buildDots = buildDots;
  CD.makeRamp = makeRamp;
  CD.hexToRgb = hexToRgb;
  CD.rgbToHex = rgbToHex;
})(CD);
