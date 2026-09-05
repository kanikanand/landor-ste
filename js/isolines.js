/* ============================================================================
 * isolines.js — marching squares.
 *
 * Extracts the iso-contour of a scalar field at a given level as linked
 * polylines. The edge renderer runs this over the signed distance field: the
 * level-0 contour is the silhouette itself, and every other level is a clean
 * offset from it.
 *
 * Contours come out linked rather than as loose segments, because dots are
 * placed by walking arc length — a bag of unordered segments cannot be
 * walked, and would space the dots by cell order instead of by distance.
 * ==========================================================================*/
var CD = window.CD || {};

(function (CD) {
  'use strict';

  /* Which cell edges each corner configuration cuts. Corners are numbered
   * TL=1, TR=2, BR=4, BL=8; edges are 0 top, 1 right, 2 bottom, 3 left. */
  var CASES = [
    [],            // 0
    [[3, 0]],      // 1  TL
    [[0, 1]],      // 2  TR
    [[3, 1]],      // 3  TL TR
    [[1, 2]],      // 4  BR
    null,          // 5  TL BR — saddle, resolved by the cell average
    [[0, 2]],      // 6  TR BR
    [[3, 2]],      // 7  TL TR BR
    [[2, 3]],      // 8  BL
    [[2, 0]],      // 9  TL BL
    null,          // 10 TR BL — saddle
    [[2, 1]],      // 11 TL TR BL
    [[1, 3]],      // 12 BR BL
    [[1, 0]],      // 13 TL BR BL
    [[0, 3]],      // 14 TR BR BL
    []             // 15
  ];

  /* Point where `level` crosses the given edge of cell (x, y). */
  function edgePoint(edge, x, y, va, vb, vc, vd, level) {
    var t;
    switch (edge) {
      case 0: t = (level - va) / (vb - va); return [x + t, y];
      case 1: t = (level - vb) / (vc - vb); return [x + 1, y + t];
      case 2: t = (level - vd) / (vc - vd); return [x + t, y + 1];
      default: t = (level - va) / (vd - va); return [x, y + t];
    }
  }

  function key(x, y) {
    return (Math.round(x * 512) * 8388608 + Math.round(y * 512));
  }

  /* Contour of `field` (channel 0) at `level`, as an array of flat
   * [x0,y0,x1,y1,...] polylines in grid coordinates. */
  function isoContours(field, level) {
    var w = field.w, h = field.h, data = field.data, n = field.n;
    var segs = [];

    for (var y = 0; y < h - 1; y++) {
      for (var x = 0; x < w - 1; x++) {
        var va = data[(y * w + x) * n];
        var vb = data[(y * w + x + 1) * n];
        var vc = data[((y + 1) * w + x + 1) * n];
        var vd = data[((y + 1) * w + x) * n];

        var bits = (va > level ? 1 : 0) | (vb > level ? 2 : 0) |
                   (vc > level ? 4 : 0) | (vd > level ? 8 : 0);
        if (bits === 0 || bits === 15) continue;

        var pairs = CASES[bits];
        if (!pairs) {
          /* Saddle: the two diagonal corners are on one side and the other two
           * on the other, so the cell alone is ambiguous. The average decides
           * which way the contour turns. */
          var avg = (va + vb + vc + vd) / 4;
          if (bits === 5) pairs = (avg > level) ? [[3, 2], [1, 0]] : [[3, 0], [1, 2]];
          else pairs = (avg > level) ? [[0, 3], [2, 1]] : [[0, 1], [2, 3]];
        }

        for (var i = 0; i < pairs.length; i++) {
          var p1 = edgePoint(pairs[i][0], x, y, va, vb, vc, vd, level);
          var p2 = edgePoint(pairs[i][1], x, y, va, vb, vc, vd, level);
          segs.push(p1[0], p1[1], p2[0], p2[1]);
        }
      }
    }
    return chain(segs);
  }

  /* Link segments end to end into polylines. Adjacent cells compute a shared
   * edge crossing from the same two corner values by the same expression, so
   * the endpoints agree exactly; the key still quantises, to be safe. */
  function chain(segs) {
    var count = segs.length / 4;
    if (!count) return [];

    var ends = new Map();
    var i, k;
    function addEnd(k, i) {
      var list = ends.get(k);
      if (!list) { list = []; ends.set(k, list); }
      list.push(i);
    }
    for (i = 0; i < count; i++) {
      addEnd(key(segs[i * 4], segs[i * 4 + 1]), i);
      addEnd(key(segs[i * 4 + 2], segs[i * 4 + 3]), i);
    }

    var used = new Uint8Array(count);
    var lines = [];

    /* Follow from one end of a segment until the chain closes or runs out. */
    function walk(from, px, py) {
      var pts = [];
      var cx = px, cy = py;
      var cur = from;
      for (;;) {
        used[cur] = 1;
        var ax = segs[cur * 4], ay = segs[cur * 4 + 1];
        var bx = segs[cur * 4 + 2], by = segs[cur * 4 + 3];
        /* step to whichever end we did not arrive at */
        var nx, ny;
        if (key(ax, ay) === key(cx, cy)) { nx = bx; ny = by; }
        else { nx = ax; ny = ay; }
        /* Two segments meeting inside one cell can repeat a point; drop it so
         * the arc-length walk that places dots sees clean geometry. */
        var last = pts.length;
        if (last < 2 || pts[last - 2] !== nx || pts[last - 1] !== ny) {
          pts.push(nx, ny);
        }
        var list = ends.get(key(nx, ny));
        var next = -1;
        if (list) {
          for (var j = 0; j < list.length; j++) {
            if (!used[list[j]]) { next = list[j]; break; }
          }
        }
        if (next < 0) break;
        cur = next; cx = nx; cy = ny;
      }
      return pts;
    }

    for (i = 0; i < count; i++) {
      if (used[i]) continue;
      /* Grow both ways from this seed so open contours are not cut in half. */
      var fwd = walk(i, segs[i * 4], segs[i * 4 + 1]);
      var back = walk(i, segs[i * 4 + 2], segs[i * 4 + 3]);
      /* `back` already ends at the seed's first endpoint and `fwd` starts at
       * its second, so the seed must not be pushed again between them. */
      var pts = [];
      for (k = back.length - 2; k >= 0; k -= 2) pts.push(back[k], back[k + 1]);
      for (k = 0; k < fwd.length; k += 2) pts.push(fwd[k], fwd[k + 1]);
      if (pts.length >= 6) lines.push(pts);
    }
    return lines;
  }

  CD.isoContours = isoContours;
})(CD);
