/* ============================================================================
 * core.js — scalar/vector field container + math helpers
 * Plain classic script. Everything hangs off the global `CD` namespace.
 * ==========================================================================*/
var CD = window.CD || {};

(function (CD) {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(e0, e1, x) {
    var t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
    return t * t * (3 - 2 * t);
  }

  /* Deterministic PRNG so a given seed always regenerates the same artwork. */
  function makeRng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  /* --------------------------------------------------------------------------
   * Field: a w*h grid of `n` interleaved float channels, sampled bilinearly in
   * grid space. Depth uses 1 channel; the flow line-field uses 2.
   * ------------------------------------------------------------------------*/
  function Field(w, h, n) {
    this.w = w; this.h = h; this.n = n || 1;
    this.data = new Float32Array(w * h * this.n);
  }

  Field.prototype.get = function (x, y, c) {
    x = x < 0 ? 0 : (x >= this.w ? this.w - 1 : x);
    y = y < 0 ? 0 : (y >= this.h ? this.h - 1 : y);
    return this.data[(y * this.w + x) * this.n + (c || 0)];
  };

  Field.prototype.set = function (x, y, c, v) {
    this.data[(y * this.w + x) * this.n + c] = v;
  };

  /* Bilinear sample at continuous grid coordinates. */
  Field.prototype.sample = function (x, y, c) {
    c = c || 0;
    var x0 = Math.floor(x), y0 = Math.floor(y);
    var fx = x - x0, fy = y - y0;
    var a = this.get(x0, y0, c), b = this.get(x0 + 1, y0, c);
    var d = this.get(x0, y0 + 1, c), e = this.get(x0 + 1, y0 + 1, c);
    return (a + (b - a) * fx) + ((d + (e - d) * fx) - (a + (b - a) * fx)) * fy;
  };

  Field.prototype.clone = function () {
    var f = new Field(this.w, this.h, this.n);
    f.data.set(this.data);
    return f;
  };

  /* Separable box blur, run `passes` times to approximate a gaussian.
   * Operates on every channel independently. radius is in grid cells. */
  Field.prototype.blur = function (radius, passes) {
    radius = Math.max(0, Math.round(radius));
    if (radius < 1) return this;
    passes = passes || 3;
    var w = this.w, h = this.h, n = this.n;
    var tmp = new Float32Array(this.data.length);
    var src = this.data, dst = tmp;
    var i, x, y, c, acc, span = radius * 2 + 1;

    for (i = 0; i < passes; i++) {
      /* horizontal */
      for (y = 0; y < h; y++) {
        for (c = 0; c < n; c++) {
          var row = y * w;
          acc = 0;
          for (x = -radius; x <= radius; x++) {
            acc += src[(row + clamp(x, 0, w - 1)) * n + c];
          }
          for (x = 0; x < w; x++) {
            dst[(row + x) * n + c] = acc / span;
            acc -= src[(row + clamp(x - radius, 0, w - 1)) * n + c];
            acc += src[(row + clamp(x + radius + 1, 0, w - 1)) * n + c];
          }
        }
      }
      var t = src; src = dst; dst = t;
      /* vertical */
      for (x = 0; x < w; x++) {
        for (c = 0; c < n; c++) {
          acc = 0;
          for (y = -radius; y <= radius; y++) {
            acc += src[(clamp(y, 0, h - 1) * w + x) * n + c];
          }
          for (y = 0; y < h; y++) {
            dst[(y * w + x) * n + c] = acc / span;
            acc -= src[(clamp(y - radius, 0, h - 1) * w + x) * n + c];
            acc += src[(clamp(y + radius + 1, 0, h - 1) * w + x) * n + c];
          }
        }
      }
      t = src; src = dst; dst = t;
    }

    if (src !== this.data) this.data.set(src);
    return this;
  };

  CD.clamp = clamp;
  CD.lerp = lerp;
  CD.smoothstep = smoothstep;
  CD.makeRng = makeRng;
  CD.Field = Field;
})(CD);
