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

  /* --------------------------------------------------------------------------
   * Exact Euclidean distance transform (Felzenszwalb & Huttenlocher, 2012).
   *
   * Given a binary mask, returns each interior cell's distance to the nearest
   * background cell — i.e. how far inside the silhouette it sits. Linear time,
   * and exact rather than the usual chamfer approximation, which matters here
   * because the distance drives dot size directly: a chamfer's octagonal bias
   * would show up as visible faceting along a curved silhouette.
   * ------------------------------------------------------------------------*/
  var EDT_INF = 1e20;

  /* Lower envelope of parabolas along one row/column. */
  function edt1d(f, d, v, z, n) {
    var k = 0, q;
    v[0] = 0;
    z[0] = -EDT_INF;
    z[1] = EDT_INF;
    for (q = 1; q < n; q++) {
      var s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = EDT_INF;
    }
    k = 0;
    for (q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      var dq = q - v[k];
      d[q] = dq * dq + f[v[k]];
    }
  }

  /* mask: Field(1ch). Cells above `iso` are inside. Returns a Field(1ch) of
   * distances to the outside, in grid cells. */
  function distanceInside(mask, iso) {
    var w = mask.w, h = mask.h;
    var out = new Field(w, h, 1);
    var g = out.data, m = mask.data;
    var i, x, y;

    for (i = 0; i < w * h; i++) g[i] = m[i] > iso ? EDT_INF : 0;

    var n = Math.max(w, h);
    var f = new Float64Array(n), d = new Float64Array(n);
    var v = new Int32Array(n), z = new Float64Array(n + 1);

    for (x = 0; x < w; x++) {
      for (y = 0; y < h; y++) f[y] = g[y * w + x];
      edt1d(f, d, v, z, h);
      for (y = 0; y < h; y++) g[y * w + x] = d[y];
    }
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) f[x] = g[y * w + x];
      edt1d(f, d, v, z, w);
      for (x = 0; x < w; x++) g[y * w + x] = Math.sqrt(d[x]);
    }
    return out;
  }

  /* Signed distance to the silhouette: positive inside the subject, negative
   * out in the background, zero on the boundary itself. Its iso-lines are
   * exactly the offset contours the edge renderer draws — one field, and the
   * contour at any offset falls out of it. */
  function signedDistance(mask, iso) {
    var w = mask.w, h = mask.h, i;
    var inv = new Field(w, h, 1);
    for (i = 0; i < w * h; i++) inv.data[i] = mask.data[i] > iso ? 0 : 1;

    var din = distanceInside(mask, iso);
    var dout = distanceInside(inv, 0.5);

    var out = new Field(w, h, 1);
    for (i = 0; i < w * h; i++) out.data[i] = din.data[i] - dout.data[i];
    return out;
  }

  /* Keep only the largest 4-connected region of the mask.
   *
   * A global luminance threshold calls *any* dark patch the subject, so a
   * graded sky that dips below the threshold in one corner grows its own
   * silhouette and the contours go wandering off across the background.
   * Keeping the largest region alone is what makes the boundary mean
   * "subject against background" rather than "wherever the luminance
   * happens to cross". */
  function largestRegion(mask, iso) {
    var w = mask.w, h = mask.h, n = w * h;
    var label = new Int32Array(n);      // 0 = unvisited
    var stack = new Int32Array(n);
    var best = 0, bestSize = 0, next = 0;
    var i;

    for (i = 0; i < n; i++) {
      if (label[i] !== 0 || mask.data[i] <= iso) continue;
      next++;
      var size = 0, sp = 0;
      stack[sp++] = i;
      label[i] = next;
      while (sp > 0) {
        var q = stack[--sp];
        size++;
        var qx = q % w, qy = (q / w) | 0;
        if (qx > 0 && label[q - 1] === 0 && mask.data[q - 1] > iso) { label[q - 1] = next; stack[sp++] = q - 1; }
        if (qx < w - 1 && label[q + 1] === 0 && mask.data[q + 1] > iso) { label[q + 1] = next; stack[sp++] = q + 1; }
        if (qy > 0 && label[q - w] === 0 && mask.data[q - w] > iso) { label[q - w] = next; stack[sp++] = q - w; }
        if (qy < h - 1 && label[q + w] === 0 && mask.data[q + w] > iso) { label[q + w] = next; stack[sp++] = q + w; }
      }
      if (size > bestSize) { bestSize = size; best = next; }
    }

    if (!best) return mask;
    var out = new Field(w, h, 1);
    for (i = 0; i < n; i++) out.data[i] = (label[i] === best) ? mask.data[i] : 0;
    return out;
  }

  /* Fill background regions that do not reach the border.
   *
   * With no blur on the depth field, any interior shadow that dips past the
   * threshold — an eye socket, the shade beside a nose — punches a hole in
   * the subject, and every hole grows its own set of contours. Largest-region
   * cannot see them: they are background, not a rival subject. Flood the
   * background inward from the border and whatever it fails to reach is
   * enclosed, so it belongs to the subject. */
  function fillEnclosed(mask, iso) {
    var w = mask.w, h = mask.h, n = w * h;
    var seen = new Uint8Array(n);
    var stack = new Int32Array(n);
    var sp = 0, i, x, y;

    function push(q) {
      if (!seen[q] && mask.data[q] <= iso) { seen[q] = 1; stack[sp++] = q; }
    }
    for (x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }

    while (sp > 0) {
      var q = stack[--sp];
      var qx = q % w, qy = (q / w) | 0;
      if (qx > 0) push(q - 1);
      if (qx < w - 1) push(q + 1);
      if (qy > 0) push(q - w);
      if (qy < h - 1) push(q + w);
    }

    var out = new Field(w, h, 1);
    for (i = 0; i < n; i++) out.data[i] = seen[i] ? 0 : 1;
    return out;
  }

  CD.distanceInside = distanceInside;
  CD.signedDistance = signedDistance;
  CD.largestRegion = largestRegion;
  CD.fillEnclosed = fillEnclosed;
  CD.clamp = clamp;
  CD.lerp = lerp;
  CD.smoothstep = smoothstep;
  CD.makeRng = makeRng;
  CD.Field = Field;
})(CD);
