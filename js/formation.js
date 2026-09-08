/* ============================================================================
 * formation.js — the dot field as a decided geometry.
 *
 * Until now there was one way the dots could be laid out: trace the image's
 * own contours and put dots along them. Everything about the layout therefore
 * came from the photograph, and the only control over it was how strongly the
 * contours were allowed to bend — the "grid to form" slider, which is a
 * strange thing to ask a designer, because it is a question about the
 * algorithm rather than about the artwork.
 *
 * A formation turns that around. The layout is CHOSEN — concentric rings, a
 * radial burst, a spiral, a lattice, a wave — and the picture is revealed
 * THROUGH it, by the dots growing and crowding where the subject is near and
 * shrinking and thinning where it falls away. The formation is the constant
 * and the image is the variable, which is the right way round for a system
 * that has to stay recognisable across hundreds of different photographs.
 *
 * Everything here emits the same thing the streamline tracer emits — flat
 * [x0,y0,x1,y1,...] polylines in view pixels — so the whole of the rest of the
 * pipeline is untouched. The dots are still walked along a path by arc length,
 * still sized and spaced from the depth field, still masked by the region.
 *
 * CIRCLE TO STAR. The three radiating formations share one radius function,
 * `rose`, which multiplies the radius by an N-fold lobe. At 0 it returns 1
 * exactly, so the ring is a circle; at 1 the valleys pull in to 0.42 and it is
 * a star. That is a single continuous axis rather than two separate shapes,
 * which is why it is one slider.
 *
 * The same caveat as the generative field applies: the star is a parametric
 * stand-in with the right behaviour, not the real mark. Replace it with the
 * actual logo construction before this is used for anything real.
 * ==========================================================================*/
var CD = window.CD || {};

(function (CD) {
  'use strict';

  var clamp = CD.clamp, lerp = CD.lerp;

  var STAR_VALLEY = 0.42;      // how far in a full star pulls its valleys

  /* Radius multiplier at angle theta. 1 at the points, STAR_VALLEY between
   * them, and exactly 1 everywhere when starness is 0 — the last part matters,
   * because a circle that is a hair off being a circle reads as a mistake. */
  function rose(theta, points, starness) {
    if (!(starness > 0)) return 1;
    var k = Math.pow(Math.cos(theta * points * 0.5), 2);
    return lerp(1, lerp(STAR_VALLEY, 1, k), starness);
  }

  function valleyOf(starness) {
    return lerp(1, STAR_VALLEY, clamp(starness || 0, 0, 1));
  }

  /* --------------------------------------------------------------------------
   * Emitter
   *
   * Collects points into a polyline and cuts it wherever the path leaves the
   * frame or leaves the region it is allowed to draw in. Cutting here rather
   * than letting the dots do it is what keeps a joined-up render honest: a row
   * drawn as a line through its own dots must not leap across the gap where
   * the subject was, and it cannot know about a gap it was never told about.
   *
   * The coverage bar is the same number the dots use, so the two agree about
   * where the region ends.
   * ------------------------------------------------------------------------*/
  function Emitter(ctx) {
    this.out = ctx.out;
    this.mask = ctx.mask;
    this.s = ctx.fieldScale;
    this.gate = ctx.gate;
    this.w = ctx.viewW;
    this.h = ctx.viewH;
    this.pad = ctx.pad === undefined ? 8 : ctx.pad;
    this.run = [];
    this.points = 0;
    this.maxPoints = ctx.maxPoints || 900000;
    this.maxLines = ctx.maxLines || 5000;
  }

  Emitter.prototype.full = function () {
    return this.points >= this.maxPoints || this.out.length >= this.maxLines;
  };

  Emitter.prototype.add = function (x, y) {
    if (x < -this.pad || y < -this.pad ||
        x > this.w + this.pad || y > this.h + this.pad) { this.cut(); return; }
    if (this.mask && this.mask.sample(x * this.s, y * this.s, 0) <= this.gate) {
      this.cut(); return;
    }
    this.run.push(x, y);
  };

  /* End the current run. Two points is the shortest thing the dot walker can
   * do anything with, so anything shorter is dropped rather than kept. */
  Emitter.prototype.cut = function () {
    if (this.run.length >= 4) {
      this.out.push(this.run);
      this.points += this.run.length >> 1;
    }
    if (this.run.length) this.run = [];
  };

  /* --------------------------------------------------------------------------
   * The formations
   * ------------------------------------------------------------------------*/

  /* Concentric rings about the focal point. The archetypal "repeating and
   * radiating" field, and the one the circle-to-star axis reads most clearly
   * on, because the lobe shows up on every ring at once. */
  function concentric(e, g) {
    var ringStep = g.ringStep, step = g.step;
    var reach = g.maxR / valleyOf(g.starness);
    for (var r = ringStep; r <= reach && !e.full(); r += ringStep) {
      var n = Math.max(24, Math.ceil((Math.PI * 2 * r) / step));
      if (n > 20000) n = 20000;
      for (var k = 0; k <= n; k++) {
        var th = (k / n) * Math.PI * 2;
        var rr = r * rose(th, g.points, g.starness);
        var a = th + g.angle;
        e.add(g.cx + rr * Math.cos(a), g.cy + rr * Math.sin(a));
      }
      e.cut();
    }
  }

  /* Spokes running outwards. The spoke count doubles at every octave of
   * radius, which is the only way a radial field stays evenly dense: a fixed
   * number of spokes is either a solid mass at the centre or a scatter at the
   * edge, and there is no count that avoids both.
   *
   * Doubling on its own leaves a visible seam — density halves across an
   * octave and then jumps back — so a new spoke is not born at the octave
   * boundary but somewhere inside it, at a radius taken from the golden-ratio
   * sequence. The count then grows continuously instead of in steps, and the
   * measured spread across the frame drops by about a third. */
  function radial(e, g) {
    var step = g.step;
    var r0 = g.ringStep * 2;
    var base = Math.max(6, Math.round((Math.PI * 2 * r0) / g.ringStep));
    var reach = g.maxR / valleyOf(g.starness);
    var levels = Math.max(1, Math.ceil(Math.log(reach / r0) / Math.LN2) + 1);
    var PHI = 0.6180339887498949;

    for (var L = 0; L < levels && !e.full(); L++) {
      var count = base << L;
      if (count > 8192) break;
      /* level 0 fills the inner disc; every level after it only adds the
       * spokes that fall between the ones already there */
      var born = L === 0 ? r0 : r0 * Math.pow(2, L - 1);
      for (var j = 0; j < count && !e.full(); j++) {
        if (L > 0 && (j & 1) === 0) continue;      // already drawn below
        var start = L === 0 ? r0 : born * Math.pow(2, ((j >> 1) * PHI) % 1);
        var th = (j / count) * Math.PI * 2;
        var end = Math.min(reach, g.maxR * rose(th, g.points, g.starness));
        if (end <= start) continue;
        var a = th + g.angle, ca = Math.cos(a), sa = Math.sin(a);
        for (var r = start; r <= end; r += step) {
          e.add(g.cx + r * ca, g.cy + r * sa);
        }
        e.add(g.cx + end * ca, g.cy + end * sa);
        e.cut();
      }
    }
  }

  /* N arms turning out from the focal point. Each arm advances by the full
   * ring spacing times the number of arms per turn, so neighbouring arms stay
   * exactly one ring spacing apart however many of them there are. */
  function spiral(e, g) {
    var arms = Math.max(1, g.points);
    var perTurn = g.ringStep * arms;
    var reach = g.maxR / valleyOf(g.starness);
    var maxTheta = (reach / perTurn) * Math.PI * 2;

    for (var i = 0; i < arms && !e.full(); i++) {
      var phase = (i / arms) * Math.PI * 2;
      for (var th = 0; th <= maxTheta; ) {
        var r = perTurn * (th / (Math.PI * 2));
        var rr = r * rose(th + phase, g.points, g.starness);
        var a = th + phase + g.angle;
        e.add(g.cx + rr * Math.cos(a), g.cy + rr * Math.sin(a));
        th += g.step / Math.max(g.ringStep, r);
      }
      e.cut();
    }
  }

  /* Parallel rows at the chosen angle: the plain repeating lattice. */
  function grid(e, g) {
    rows(e, g, function () { return 0; });
  }

  /* The same rows, displaced across themselves by a sine. Successive rows are
   * offset in phase, so the field reads as a travelling wave rather than as a
   * stack of identical curves. */
  function wave(e, g) {
    var amp = g.ringStep * 0.55;
    var wl = Math.max(8, g.ringStep * 8);
    return rows(e, g, function (s, row) {
      return amp * Math.sin((s / wl) * Math.PI * 2 + row * 0.55);
    });
  }

  function rows(e, g, offset) {
    var ux = Math.cos(g.angle), uy = Math.sin(g.angle);
    var nx = -uy, ny = ux;
    var half = Math.hypot(g.w, g.h) * 0.5 + g.ringStep;
    var cx = g.w * 0.5, cy = g.h * 0.5;
    var row = 0;

    for (var t = -half; t <= half && !e.full(); t += g.ringStep, row++) {
      for (var s = -half; s <= half; s += g.step) {
        var d = t + offset(s, row);
        e.add(cx + ux * s + nx * d, cy + uy * s + ny * d);
      }
      e.cut();
    }
  }

  var KINDS = {
    concentric: concentric, radial: radial, spiral: spiral,
    grid: grid, wave: wave
  };

  /* --------------------------------------------------------------------------
   * build
   *
   * ctx: {viewW, viewH, mask, fieldScale, params, gate}
   * Returns polylines, or null when the formation is `contour`, which is the
   * streamline tracer's job and not this module's.
   * ------------------------------------------------------------------------*/
  function build(ctx) {
    var p = ctx.params;
    var kind = KINDS[p.formation];
    if (!kind) return null;

    var W = ctx.viewW, H = ctx.viewH;
    var out = [];
    var ringStep = Math.max(2, p.lineSpacing);
    var cx = (p.focusX === undefined ? 0.5 : p.focusX) * W;
    var cy = (p.focusY === undefined ? 0.45 : p.focusY) * H;

    var g = {
      w: W, h: H, cx: cx, cy: cy,
      angle: (p.flowAngle || 0) * Math.PI / 180,
      ringStep: ringStep,
      /* Path sampling. Fine enough that the dot walker's straight-line steps
       * do not visibly cut the corners of a ring, and no finer: every extra
       * sample is paid for on every one of the thousands of rows. */
      step: clamp(ringStep * 0.4, 1.6, 4),
      points: Math.max(3, Math.round(p.starPoints || 5)),
      starness: clamp(p.starness === undefined ? 0 : p.starness, 0, 1),
      maxR: 0
    };

    /* far corner from the centre, so a radiating formation covers the frame */
    g.maxR = Math.max(
      Math.hypot(cx, cy), Math.hypot(W - cx, cy),
      Math.hypot(cx, H - cy), Math.hypot(W - cx, H - cy)) + ringStep;

    var e = new Emitter({
      out: out, mask: ctx.mask, fieldScale: ctx.fieldScale, gate: ctx.gate,
      viewW: W, viewH: H, maxPoints: p.maxPoints, maxLines: p.maxLines
    });

    kind(e, g);
    e.cut();
    return out;
  }

  CD.Formation = {
    build: build, rose: rose, KINDS: KINDS,
    ORDER: ['contour', 'concentric', 'radial', 'spiral', 'grid', 'wave']
  };
})(CD);
