/* ============================================================================
 * abstract.js — the twelve named formations.
 *
 * Each one is a KEYWORD given a shape: emergence, ingenuity, progress,
 * convergence, expansion, adaptation, connection, collaboration, precision,
 * transformation, synergy, momentum. They are not decorations chosen for how
 * they look; each is a described behaviour, and the description is what the
 * function has to satisfy.
 *
 * All twelve are height fields, exactly like a depth map, so everything
 * downstream is untouched: the same dots, walked along the same formation,
 * growing and crowding where the height is high and shrinking and thinning
 * where it is low. That is the whole mechanism — a formation decides where
 * the dots sit, a field decides how much dot there is at each place, and the
 * picture emerges from the second acting on the first.
 *
 * COORDINATES. Every field is written in a centred space where the SHORT side
 * of the frame runs -1..1 and the long side runs past it, so a circle is a
 * circle at any aspect ratio and a field written for a square still reads on a
 * banner. The focal point shifts that space and the field angle rotates it,
 * which is why neither is baked into any of the functions below.
 *
 * A NOTE ON WHAT THESE ARE NOT. None of them draws a shape. There is no star
 * scattered through the pattern and no logo hidden in the dots: the field is
 * an organising influence and the dots are always the same circular primitive.
 * Where a description says "points" or "lobes" it is the DENSITY that has the
 * lobe, not the mark.
 * ==========================================================================*/
var CD = window.CD || {};

(function (CD) {
  'use strict';

  var clamp = CD.clamp, lerp = CD.lerp, smoothstep = CD.smoothstep;

  /* --------------------------------------------------------------------------
   * Primitives. Every field below is built from these four, which is what
   * keeps the set coherent: twelve different arrangements of the same handful
   * of moves, rather than twelve unrelated pieces of maths.
   * ------------------------------------------------------------------------*/

  /* A soft bell of radius r. 1 at the centre, ~0.37 at r, effectively 0 by 2r. */
  function bell(d, r) {
    var t = d / (r || 1e-6);
    return Math.exp(-t * t);
  }

  /* Distance from (x,y) to the segment (ax,ay)-(bx,by). The channels, necks
   * and bridges are all tubes about a segment. */
  function segDist(x, y, ax, ay, bx, by) {
    var vx = bx - ax, vy = by - ay;
    var wx = x - ax, wy = y - ay;
    var L = vx * vx + vy * vy;
    var t = L > 1e-9 ? clamp((wx * vx + wy * vy) / L, 0, 1) : 0;
    return Math.hypot(wx - vx * t, wy - vy * t);
  }

  /* An anisotropic bell: long by `lx`, narrow by `ly`, turned by `rot`. */
  function blade(x, y, cx, cy, lx, ly, rot) {
    var dx = x - cx, dy = y - cy;
    var c = Math.cos(-rot), s = Math.sin(-rot);
    var ax = dx * c - dy * s, ay = dx * s + dy * c;
    return bell(Math.hypot(ax / lx, ay / ly), 1);
  }

  /* A disc with a graduated edge rather than a cut one. */
  function disc(d, r, soft) {
    return smoothstep(r, r * (1 - clamp(soft, 0.02, 0.98)), d);
  }

  /* --------------------------------------------------------------------------
   * The twelve
   *
   * Each returns a height in roughly 0..1; the builder renormalises afterwards,
   * so what matters here is the RELATIVE structure — which parts are dense and
   * which are open — not the absolute numbers.
   * ------------------------------------------------------------------------*/

  var FIELDS = {

    /* Emergence — a concentrated centre gradually becoming visible within a
     * faint, diffuse circular field. The wide term is deliberately weak: the
     * point is that there is almost nothing there, and then there is. */
    emergence: function (x, y) {
      var r = Math.hypot(x, y);
      var haze = 0.42 * disc(r, 0.78, 0.9);
      var core = bell(r, 0.26);
      return haze + 0.85 * core;
    },

    /* Ingenuity — a rounded central mass stretching into four soft points. The
     * lobe is on the RADIUS of the mass, so it is one form growing points
     * rather than four shapes arranged in a cross. */
    ingenuity: function (x, y, p) {
      var r = Math.hypot(x, y);
      var a = Math.atan2(y, x);
      var n = Math.max(3, Math.round(p.lobes || 4));
      /* The lobe has to be strong and the falloff tight, or the points blur
       * back into the circle they grew out of and the whole idea is lost. */
      var reach = 0.30 * (1 + 1.15 * Math.pow(Math.abs(Math.cos(a * n * 0.5)), 2.4));
      return bell(r / reach, 0.78);
    },

    /* Progress — an elongated formation with a dense leading edge and a
     * tapering trail. The front is a shorter falloff than the back, which is
     * the only reason it reads as travelling rather than as an ellipse. */
    progress: function (x, y) {
      var head = 0.34;
      var s = x - head;
      var behind = s < 0;
      /* Both terms are continuous across the head — the falloff lengths differ
       * either side of it but they agree at s = 0, and the width opens from
       * zero rather than from a step. An extra weight on the leading half
       * would be a 15% jump in density exactly where the eye is looking, and
       * it renders as a seam across the front of the plume. */
      var along = bell(s, behind ? 0.85 : 0.22);
      var width = 0.17 + (behind ? 0.30 * Math.min(1, -s) : 0);
      return along * bell(y, width);
    },

    /* Convergence — several soft concentrations drawing inward towards one
     * shared centre, with subtle channels connecting them. The channels are
     * weak on purpose: they are evidence of a relationship, not the subject. */
    convergence: function (x, y, p) {
      var n = Math.max(3, Math.round(p.lobes || 4));
      /* The centre is larger and brighter than any satellite. Equal weights
       * read as a ring of blobs; the gradient towards the middle is what makes
       * it a gathering rather than an arrangement. */
      var h = bell(Math.hypot(x, y), 0.26);
      for (var i = 0; i < n; i++) {
        var a = (i / n) * Math.PI * 2 + 0.35;
        var sx = Math.cos(a) * 0.55, sy = Math.sin(a) * 0.55;
        h = Math.max(h, 0.70 * bell(Math.hypot(x - sx, y - sy), 0.15));
        h = Math.max(h, 0.42 * bell(segDist(x, y, sx, sy, 0, 0), 0.055));
      }
      return h;
    },

    /* Expansion — a broad ring of larger dots around an open centre,
     * dissolving into smaller dots at its outer edge. Open means open: the
     * centre must go to nothing, or it is a disc with a bright rim. */
    expansion: function (x, y) {
      var r = Math.hypot(x, y);
      return bell(r - 0.46, 0.20) * smoothstep(1.05, 0.42, r);
    },

    /* Adaptation — a continuous undulating form that rises on one side and
     * dips on the other, flexing without breaking apart. A saddle, windowed
     * so it stays one connected thing rather than two opposite corners. */
    adaptation: function (x, y) {
      var c = Math.cos(0.55), s = Math.sin(0.55);
      var u = x * c - y * s, v = x * s + y * c;
      /* A saddle: dense along one axis, open along the other. Windowed into a
       * form rather than left to run to the edges — unwindowed it fills the
       * frame with a diagonal gradient, which is a background and not a
       * formation. The window is also what stops it breaking apart: every
       * part of it is connected to the middle. */
      var saddle = clamp(0.5 + 1.10 * (u * u - v * v), 0, 1);
      var form = bell(Math.hypot(u * 0.95, v * 1.10), 0.62);
      return form * (0.06 + 0.94 * saddle);
    },

    /* Connection — two rounded masses joined by a narrow dotted neck. The neck
     * is thin and it is continuous; a gap would be two things, and a thick one
     * would be a single blob. */
    connection: function (x, y) {
      var g1 = bell(Math.hypot(x + 0.46, y), 0.29);
      var g2 = bell(Math.hypot(x - 0.46, y), 0.29);
      var neck = bell(segDist(x, y, -0.46, 0, 0.46, 0), 0.075);
      return Math.max(Math.max(g1, g2), 0.62 * neck);
    },

    /* Collaboration — two overlapping circular fields creating a third, more
     * concentrated formation where they meet. The product term is the whole
     * idea: the lens exists only where both are present. */
    collaboration: function (x, y) {
      /* Both circles have to be legible as circles or the lens is just a blob:
       * at a low weight they vanish under the overlap and the picture stops
       * being about two things meeting. Far enough apart to read as two, close
       * enough that the intersection is a real third form. */
      var d1 = disc(Math.hypot(x + 0.38, y), 0.66, 0.5);
      var d2 = disc(Math.hypot(x - 0.38, y), 0.66, 0.5);
      return 0.60 * Math.max(d1, d2) + 0.72 * (d1 * d2);
    },

    /* Precision — a flattened elliptical field concentrating into a tightly
     * controlled central band, with finely graduated edges. */
    precision: function (x, y) {
      var e = Math.hypot(x / 0.92, y / 0.34);
      var body = smoothstep(1.08, 0.15, e);
      var band = bell(y, 0.075) * smoothstep(1.0, 0.55, Math.abs(x));
      return 0.62 * body + 0.7 * band;
    },

    /* Transformation — a vertical form that narrows and turns at its midpoint,
     * opening into differently oriented lobes above and below. The turn is the
     * change of angle between the two blades; the narrowing is the neck. */
    transformation: function (x, y) {
      var top = blade(x, y, 0, -0.42, 0.40, 0.20, -0.55);
      var bot = blade(x, y, 0, 0.42, 0.40, 0.20, 0.62);
      var neck = bell(segDist(x, y, 0, -0.30, 0, 0.30), 0.11);
      return Math.max(Math.max(top, bot), 0.66 * neck);
    },

    /* Synergy — three or four rounded volumes gathered around a shared centre,
     * distinct but forming one whole. Max keeps them distinct; the shared
     * plateau underneath is what makes them one thing. */
    synergy: function (x, y, p) {
      var n = Math.max(3, Math.round(p.lobes || 3));
      var h = 0.30 * disc(Math.hypot(x, y), 0.78, 0.6);
      for (var i = 0; i < n; i++) {
        var a = (i / n) * Math.PI * 2 - Math.PI / 2;
        h = Math.max(h, bell(Math.hypot(x - Math.cos(a) * 0.40,
                                        y - Math.sin(a) * 0.40), 0.26));
      }
      return h;
    },

    /* Momentum — a stretched, gently oscillating ribbon carrying alternating
     * concentrations across the composition. The concentrations run at a
     * different rate from the oscillation, so the beat travels. */
    momentum: function (x, y) {
      /* Two rates, deliberately: the ribbon undulates at one and the
       * concentrations along it beat at another, so the dense passages travel
       * rather than sitting at the crests. */
      var centre = 0.30 * Math.sin(x * 3.0);
      var ribbon = bell(y - centre, 0.26);
      /* The beat never reaches zero. Letting it would break the ribbon into
        * a row of separate blobs, and the description is a ribbon that CARRIES
        * concentrations — continuity is the noun and the alternation is the
        * adjective, not the other way round. */
      var beat = 0.72 + 0.28 * Math.cos(x * 6.0 - 0.8);
      return ribbon * beat;
    }
  };

  /* The order they are offered in, and the keyword each one carries. The
   * keyword is the point: the formation is named for what it means, and the
   * visual description is how you check whether it still means it.
   *
   * `fill` is how much of the frame that formation wants. It is per-field
   * rather than global because the twelve do not have one natural size: a core
   * inside a haze is mostly empty space and has to be brought forward, while a
   * ribbon that already crosses the composition has to be left alone. Framing
   * every one of them by the same rule leaves half the set floating in the
   * middle of the page, which is a layout mistake and not a field. */
  var META = {
    emergence:      { fill: 1.15, keyword: 'Emergence',      name: 'Emerging core',
      note: 'A concentrated centre gradually becomes visible within a faint, diffuse circular field — something taking shape from possibility.' },
    ingenuity:      { fill: 1.3, keyword: 'Ingenuity',      name: 'Soft star',
      note: 'A rounded central mass stretches into four soft points, suggesting an unexpected form developing from a simple circle.' },
    progress:       { fill: 1.15, keyword: 'Progress',       name: 'Directional plume',
      note: 'An elongated formation with a dense leading edge and a tapering trail, creating a clear sense of forward movement.' },
    convergence:    { fill: 1.25, keyword: 'Convergence',    name: 'Gathering field',
      note: 'Several soft concentrations draw inward toward one shared centre, with subtle channels connecting them.' },
    expansion:      { fill: 1.1, keyword: 'Expansion',      name: 'Expanding halo',
      note: 'A broad ring of larger dots surrounds an open centre, dissolving into smaller dots at its outer edge.' },
    adaptation:     { fill: 1.05, keyword: 'Adaptation',     name: 'Flowing saddle',
      note: 'A continuous, undulating form rises on one side and dips on the other, flexing without breaking apart.' },
    connection:     { fill: 1.1, keyword: 'Connection',     name: 'Connecting bridge',
      note: 'Two rounded masses are joined by a narrow dotted neck — a visible relationship between distinct elements.' },
    collaboration:  { fill: 1.0, keyword: 'Collaboration',  name: 'Interference bloom',
      note: 'Two overlapping circular fields create a third, more concentrated formation where they meet.' },
    precision:      { fill: 1.0, keyword: 'Precision',      name: 'Focused lens',
      note: 'A flattened elliptical field concentrates into a tightly controlled central band, with finely graduated edges.' },
    transformation: { fill: 1.35, keyword: 'Transformation', name: 'Twisted column',
      note: 'A vertical form narrows and turns at its midpoint, opening into differently oriented lobes above and below.' },
    synergy:        { fill: 1.25, keyword: 'Synergy',        name: 'Balanced lobes',
      note: 'Three or four rounded volumes gather around a shared centre, remaining distinct while forming one coherent whole.' },
    momentum:       { fill: 0.9, keyword: 'Momentum',       name: 'Continuous wave',
      note: 'A stretched, gently oscillating ribbon carries alternating concentrations of dots across the composition.' }
  };

  var ORDER = ['emergence', 'ingenuity', 'progress', 'convergence', 'expansion',
               'adaptation', 'connection', 'collaboration', 'precision',
               'transformation', 'synergy', 'momentum'];

  /* --------------------------------------------------------------------------
   * build — evaluate one field onto the analysis grid.
   * ------------------------------------------------------------------------*/
  function build(w, h, name, p) {
    var fn = FIELDS[name] || FIELDS.emergence;
    p = p || {};

    var f = new CD.Field(w, h, 1), d = f.data;

    /* short side spans -1..1, so a circle stays a circle at any aspect */
    var sx = w >= h ? w / h : 1;
    var sy = h > w ? h / w : 1;
    var cx = (p.focusX === undefined ? 0.5 : p.focusX);
    var cy = (p.focusY === undefined ? 0.5 : p.focusY);
    var ang = -(p.fieldAngle || 0) * Math.PI / 180;
    var ca = Math.cos(ang), sa = Math.sin(ang);
    var meta = META[name] || {};
    var zoom = 1 / (Math.max(0.15, p.fieldScale === undefined ? 1 : p.fieldScale) *
                    (meta.fill || 1));

    var i = 0;
    for (var y = 0; y < h; y++) {
      var v = ((y + 0.5) / h - cy) * 2 * sy * zoom;
      for (var x = 0; x < w; x++, i++) {
        var u = ((x + 0.5) / w - cx) * 2 * sx * zoom;
        d[i] = fn(u * ca - v * sa, u * sa + v * ca, p);
      }
    }

    /* Renormalise, for the same reason the generative field does: intensity
     * and colour should read the full range whatever the field happened to
     * produce, and a field whose peak is 0.7 would otherwise render as a
     * quieter version of itself rather than as itself. */
    var lo = Infinity, hi = -Infinity, n = w * h;
    for (i = 0; i < n; i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
    var span = (hi - lo) || 1;
    for (i = 0; i < n; i++) d[i] = (d[i] - lo) / span;

    return f;
  }

  CD.Abstract = { FIELDS: FIELDS, META: META, ORDER: ORDER, build: build };
})(CD);
