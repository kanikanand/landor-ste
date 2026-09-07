/* ============================================================================
 * streamlines.js — evenly-spaced contour streamlines.
 *
 * Integrates the flow field with RK2 and keeps neighbouring lines a controlled
 * distance apart (Jobard & Lefer, 1997): trace a line, then seed new lines at
 * a perpendicular offset from it, rejecting any seed that falls too near a
 * line that already exists. That is what produces the even, woven bands of
 * the reference image instead of clumped or crossing curves.
 *
 * Separation is depth-modulated, so near (white) regions of the surface carry
 * more lines than far (black) ones.
 * ==========================================================================*/
var CD = window.CD || {};

(function (CD) {
  'use strict';

  var lerp = CD.lerp;

  /* Uniform grid of committed sample points, for the "is anything nearby?"
   * query that runs on every integration step. */
  function Hash(w, h, cell) {
    this.cell = Math.max(2, cell);
    this.cols = Math.ceil(w / this.cell) + 1;
    this.rows = Math.ceil(h / this.cell) + 1;
    this.bins = new Array(this.cols * this.rows);
  }

  Hash.prototype.add = function (x, y) {
    var c = (x / this.cell) | 0, r = (y / this.cell) | 0;
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return;
    var k = r * this.cols + c;
    var b = this.bins[k];
    if (!b) { b = this.bins[k] = []; }
    b.push(x, y);
  };

  /* True if any stored point lies within `dist` of (x,y). */
  Hash.prototype.near = function (x, y, dist) {
    var d2 = dist * dist;
    var span = Math.ceil(dist / this.cell);
    var c = (x / this.cell) | 0, r = (y / this.cell) | 0;
    for (var j = r - span; j <= r + span; j++) {
      if (j < 0 || j >= this.rows) continue;
      for (var i = c - span; i <= c + span; i++) {
        if (i < 0 || i >= this.cols) continue;
        var b = this.bins[j * this.cols + i];
        if (!b) continue;
        for (var k = 0; k < b.length; k += 2) {
          var dx = b[k] - x, dy = b[k + 1] - y;
          if (dx * dx + dy * dy < d2) return true;
        }
      }
    }
    return false;
  };

  /* --------------------------------------------------------------------------
   * Tracer
   * ------------------------------------------------------------------------*/
  function Tracer(ctx) {
    this.flow = ctx.flow;         // Field(2ch) doubled-angle line field
    this.depth = ctx.depth;       // Field(1ch) 0..1
    this.mask = ctx.mask;         // Field(1ch) 0..1 region coverage
    this.w = ctx.viewW;
    this.h = ctx.viewH;
    this.s = ctx.fieldScale;      // view px -> field px
    this.p = ctx.params;
    this.rng = ctx.rng;

    var p = this.p;
    /* How much coverage a point needs before a line may run through it. Half
     * is the hard edge; dissolving the region edge lowers the bar so lines
     * carry on into the feather, where the dots shrink away rather than
     * stopping mid-row. Lines and dots share this number so they agree about
     * where the region ends. */
    this.insideMin = ctx.insideMin !== undefined ? ctx.insideMin : 0.5;
    this.densityAmt = p.densityDepth === undefined ? 1
      : (p.densityDepth < 0 ? 0 : (p.densityDepth > 1 ? 1 : p.densityDepth));
    this.sepBase = Math.max(1.2, p.lineSpacing / Math.max(0.05, p.lineDensity));
    this.sepMin = this.sepBase * 0.6;
    this.sepMax = this.sepBase * 1.7;
    this.step = Math.max(0.6, this.sepMin * 0.4);
    this.maxSteps = Math.ceil(p.maxLineLength / this.step);
    this.hash = new Hash(this.w, this.h, Math.max(3, this.sepMin));
  }

  Tracer.prototype.depthAt = function (x, y) {
    return this.depth.sample(x * this.s, y * this.s, 0);
  };

  Tracer.prototype.maskAt = function (x, y) {
    return this.mask.sample(x * this.s, y * this.s, 0);
  };

  /* Separation distance wanted at this point: tighter where the surface is
   * near the camera, looser where it falls away — as much as Depth -> density
   * asks for. At 0 the spacing is uniform and the bands cover a region evenly
   * whatever its tone, which is what you want when the selection is a segment
   * of the subject rather than a tonal range of it. */
  Tracer.prototype.sepAt = function (x, y) {
    var d = this.depthAt(x, y);
    return lerp(this.sepBase, lerp(this.sepMax, this.sepMin, d), this.densityAmt);
  };

  Tracer.prototype.inside = function (x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h &&
           this.maskAt(x, y) > this.insideMin;
  };

  Tracer.prototype.dir = function (x, y) {
    return CD.dirAt(this.flow, x * this.s, y * this.s);
  };

  /* Integrate one half of a streamline. sign picks the direction of travel. */
  Tracer.prototype.integrate = function (sx, sy, sign) {
    var pts = [];
    var x = sx, y = sy;
    var prevX = 0, prevY = 0, hasPrev = false;
    var h = this.step * sign;
    /* Own points are committed to a private hash on a delay, so a line can
     * curve gently without tripping its own proximity test. */
    var self = new Hash(this.w, this.h, Math.max(3, this.sepMin));
    var lag = Math.max(6, Math.ceil(this.sepMax / this.step) + 2);
    var trail = [];

    for (var i = 0; i < this.maxSteps; i++) {
      var d1 = this.dir(x, y);
      var d1x = d1.x, d1y = d1.y;
      if (hasPrev && (d1x * prevX + d1y * prevY) < 0) { d1x = -d1x; d1y = -d1y; }

      /* RK2 midpoint */
      var mx = x + d1x * h * 0.5, my = y + d1y * h * 0.5;
      var d2 = this.dir(mx, my);
      var d2x = d2.x, d2y = d2.y;
      if ((d2x * d1x + d2y * d1y) < 0) { d2x = -d2x; d2y = -d2y; }

      var nx = x + d2x * h, ny = y + d2y * h;
      if (!this.inside(nx, ny)) break;

      var sep = this.sepAt(nx, ny);
      if (this.hash.near(nx, ny, sep * 0.92)) break;
      if (self.near(nx, ny, sep * 0.75)) break;   // self-intersection / spiral

      pts.push(nx, ny);
      trail.push(nx, ny);
      if (trail.length > lag * 2) {
        self.add(trail.shift(), trail.shift());
      }

      prevX = d2x; prevY = d2y; hasPrev = true;
      x = nx; y = ny;
    }
    return pts;
  };

  /* Full streamline through a seed: backwards, then forwards. */
  Tracer.prototype.trace = function (sx, sy) {
    if (!this.inside(sx, sy)) return null;
    if (this.hash.near(sx, sy, this.sepAt(sx, sy) * 0.92)) return null;

    var back = this.integrate(sx, sy, -1);
    var fwd = this.integrate(sx, sy, 1);

    var pts = [];
    for (var i = back.length - 2; i >= 0; i -= 2) pts.push(back[i], back[i + 1]);
    pts.push(sx, sy);
    for (var j = 0; j < fwd.length; j += 2) pts.push(fwd[j], fwd[j + 1]);

    if (pts.length < this.p.minLinePoints * 2) return null;
    for (var k = 0; k < pts.length; k += 2) this.hash.add(pts[k], pts[k + 1]);
    return pts;
  };

  /* Candidate seeds sit one separation distance either side of an existing
   * line, sampled along its length. */
  Tracer.prototype.seedsAlong = function (pts, out) {
    var stride = Math.max(2, Math.round(this.sepBase / this.step));
    for (var i = 0; i < pts.length - 2; i += stride * 2) {
      var x = pts[i], y = pts[i + 1];
      var dx = pts[i + 2] - x, dy = pts[i + 3] - y;
      var l = Math.hypot(dx, dy);
      if (l < 1e-6) continue;
      var nxp = -dy / l, nyp = dx / l;
      var sep = this.sepAt(x, y);
      out.push(x + nxp * sep, y + nyp * sep);
      out.push(x - nxp * sep, y - nyp * sep);
    }
  };

  /* Run the whole thing. Returns an array of flat [x0,y0,x1,y1,...] polylines. */
  Tracer.prototype.run = function () {
    var lines = [];
    var queue = [];
    var p = this.p;
    var totalPoints = 0;

    /* Start from the nearest point of the surface — the brightest, most
     * "forward" part of the form — so the densest structure is laid down
     * first and everything else packs around it. */
    var best = null, bestD = -1;
    var stepX = Math.max(1, Math.floor(this.w / 120));
    for (var y = 0; y < this.h; y += stepX) {
      for (var x = 0; x < this.w; x += stepX) {
        if (this.maskAt(x, y) <= this.insideMin) continue;
        var d = this.depthAt(x, y);
        if (d > bestD) { bestD = d; best = [x, y]; }
      }
    }
    if (!best) return lines;
    queue.push(best[0], best[1]);

    var randomTries = 0;
    var maxRandomTries = 6000;

    while (lines.length < p.maxLines && totalPoints < p.maxPoints) {
      if (queue.length === 0) {
        /* The frontier died out (happens across disconnected regions such as
         * a separated hand and face). Probe randomly for unfilled space. */
        var found = false;
        while (randomTries++ < maxRandomTries) {
          var rx = this.rng() * this.w, ry = this.rng() * this.h;
          if (this.inside(rx, ry) && !this.hash.near(rx, ry, this.sepAt(rx, ry) * 0.92)) {
            queue.push(rx, ry); found = true; break;
          }
        }
        if (!found) break;
      }

      var sy = queue.pop(), sx = queue.pop();
      var line = this.trace(sx, sy);
      if (!line) continue;
      lines.push(line);
      totalPoints += line.length / 2;
      this.seedsAlong(line, queue);
    }

    return lines;
  };

  CD.Tracer = Tracer;
})(CD);
