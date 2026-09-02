/* ============================================================================
 * shapes.js — the dot primitive.
 *
 * A dot is not a particle: it is a small oriented piece of geometry that turns
 * with the surface. Every shape is stored once, as a path in a unit box
 * (-1..1 on both axes, centred on the origin), and every dot is that one path
 * placed with translate -> rotate -> scale. The canvas renderer and the SVG
 * exporter consume exactly the same definition, so what you export is what you
 * saw.
 *
 *   drawDot(ctx, x, y, size, rotation, type)
 *
 * `type` is "circle" | "square" | "diamond" | "line" | "custom", where custom
 * is any uploaded SVG, normalised into the same unit box.
 * ==========================================================================*/
var CD = window.CD || {};

(function (CD) {
  'use strict';

  /* Built-in primitives, each already normalised to the unit box. `spin` marks
   * shapes whose appearance actually changes with rotation — for the others the
   * rotate() can be dropped from the export to keep the file small. */
  var BUILTIN = {
    circle: {
      d: 'M-1,0A1,1 0 1,0 1,0A1,1 0 1,0 -1,0Z',
      spin: false, round: true
    },
    square: {
      d: 'M-1,-1H1V1H-1Z',
      spin: true
    },
    diamond: {
      d: 'M0,-1L1,0L0,1L-1,0Z',
      spin: true
    },
    /* A capsule: strongly directional, so contour rotation reads clearly. */
    line: {
      d: 'M-0.68,-0.32H0.68A0.32,0.32 0 0 1 0.68,0.32H-0.68A0.32,0.32 0 0 1 -0.68,-0.32Z',
      spin: true
    }
  };

  function Shape(def) {
    this.d = def.d;
    this.spin = def.spin !== false;
    this.round = !!def.round;
    /* normalisation applied *inside* the unit box: scale then recentre */
    this.nsx = def.nsx === undefined ? 1 : def.nsx;
    this.nsy = def.nsy === undefined ? 1 : def.nsy;
    this.cx = def.cx || 0;
    this.cy = def.cy || 0;
    this.name = def.name || 'shape';
    this._path = null;
  }

  /* Lazily built Path2D, pre-normalised so callers only apply the per-dot
   * translate/rotate/scale. */
  Shape.prototype.path2d = function () {
    if (this._path) return this._path;
    var p = new Path2D();
    var inner = new Path2D(this.d);
    var m = null;
    if (typeof DOMMatrix !== 'undefined') {
      m = new DOMMatrix().scaleSelf(this.nsx, this.nsy).translateSelf(-this.cx, -this.cy);
    }
    if (m) p.addPath(inner, m); else p.addPath(inner);
    this._path = p;
    return p;
  };

  /* The transform that maps the raw path into the unit box, as an SVG string.
   * Empty for shapes that are already normalised. */
  Shape.prototype.normTransform = function () {
    var t = '';
    if (this.nsx !== 1 || this.nsy !== 1) {
      t += 'scale(' + r4(this.nsx) + (this.nsx === this.nsy ? '' : ',' + r4(this.nsy)) + ')';
    }
    if (this.cx || this.cy) t += 'translate(' + r4(-this.cx) + ',' + r4(-this.cy) + ')';
    return t;
  };

  function r4(v) { return Math.round(v * 10000) / 10000; }

  var registry = {};
  Object.keys(BUILTIN).forEach(function (k) {
    registry[k] = new Shape({ d: BUILTIN[k].d, spin: BUILTIN[k].spin, round: BUILTIN[k].round, name: k });
  });

  function getShape(type) {
    return registry[type] || registry.circle;
  }

  function setCustomShape(shape) { registry.custom = shape; }
  function hasCustomShape() { return !!registry.custom; }

  /* --------------------------------------------------------------------------
   * drawDot — the single primitive every dot goes through.
   * ------------------------------------------------------------------------*/
  function drawDot(ctx, x, y, size, rotation, type) {
    var shape = getShape(type);
    if (shape.round && !shape.custom) {
      /* fast path: a circle needs no transform stack at all */
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.save();
    ctx.translate(x, y);
    if (shape.spin) ctx.rotate(rotation);
    ctx.scale(size, size);
    ctx.fill(shape.path2d());
    ctx.restore();
  }

  /* --------------------------------------------------------------------------
   * Custom SVG upload -> unit-box shape.
   *
   * Flattens the primitive elements of an uploaded SVG into one path, measures
   * it with getBBox(), and derives the scale/offset that fits it in the unit
   * box while preserving aspect ratio.
   * ------------------------------------------------------------------------*/
  function elementToPath(el) {
    var t = el.tagName.toLowerCase();
    var n = function (a, dflt) {
      var v = parseFloat(el.getAttribute(a));
      return isNaN(v) ? (dflt || 0) : v;
    };
    switch (t) {
      case 'path':
        return el.getAttribute('d') || '';
      case 'circle': {
        var cx = n('cx'), cy = n('cy'), r = n('r');
        if (r <= 0) return '';
        return 'M' + (cx - r) + ',' + cy + 'a' + r + ',' + r + ' 0 1,0 ' + (2 * r) + ',0' +
               'a' + r + ',' + r + ' 0 1,0 ' + (-2 * r) + ',0Z';
      }
      case 'ellipse': {
        var ex = n('cx'), ey = n('cy'), rx = n('rx'), ry = n('ry');
        if (rx <= 0 || ry <= 0) return '';
        return 'M' + (ex - rx) + ',' + ey + 'a' + rx + ',' + ry + ' 0 1,0 ' + (2 * rx) + ',0' +
               'a' + rx + ',' + ry + ' 0 1,0 ' + (-2 * rx) + ',0Z';
      }
      case 'rect': {
        var x = n('x'), y = n('y'), w = n('width'), h = n('height');
        if (w <= 0 || h <= 0) return '';
        return 'M' + x + ',' + y + 'h' + w + 'v' + h + 'h' + (-w) + 'Z';
      }
      case 'line':
        return 'M' + n('x1') + ',' + n('y1') + 'L' + n('x2') + ',' + n('y2');
      case 'polygon':
      case 'polyline': {
        var pts = (el.getAttribute('points') || '').trim();
        if (!pts) return '';
        return 'M' + pts.replace(/\s*,\s*/g, ',').replace(/\s+/g, 'L') +
               (t === 'polygon' ? 'Z' : '');
      }
      default:
        return '';
    }
  }

  /* Parse SVG source text into a Shape. Throws with a readable message. */
  function shapeFromSVG(text, name) {
    var doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('That file is not valid SVG.');
    }
    var svg = doc.documentElement;
    if (!svg || svg.tagName.toLowerCase() !== 'svg') {
      throw new Error('No <svg> root element found.');
    }

    var sel = 'path,circle,ellipse,rect,line,polygon,polyline';
    var nodes = svg.querySelectorAll(sel);
    var parts = [];
    for (var i = 0; i < nodes.length; i++) {
      var d = elementToPath(nodes[i]);
      if (d) parts.push(d);
    }
    if (!parts.length) {
      throw new Error('No drawable shapes found in that SVG. Flatten strokes to fills and retry.');
    }
    var combined = parts.join(' ');

    /* Measure with a real, laid-out SVG node — the only reliable way to get a
     * bounding box for arbitrary path data. */
    var probe = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    probe.setAttribute('width', '10'); probe.setAttribute('height', '10');
    probe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;opacity:0';
    var pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', combined);
    probe.appendChild(pathEl);
    document.body.appendChild(probe);
    var bb;
    try { bb = pathEl.getBBox(); }
    finally { document.body.removeChild(probe); }

    if (!bb || !bb.width || !bb.height) {
      throw new Error('That SVG has no measurable area.');
    }

    /* Fit the longest side into the unit box, keeping aspect ratio. */
    var s = 2 / Math.max(bb.width, bb.height);
    var shape = new Shape({
      d: combined,
      spin: true,
      nsx: s, nsy: s,
      cx: bb.x + bb.width / 2,
      cy: bb.y + bb.height / 2,
      name: name || 'custom'
    });
    shape.custom = true;
    return shape;
  }

  CD.Shape = Shape;
  CD.getShape = getShape;
  CD.setCustomShape = setCustomShape;
  CD.hasCustomShape = hasCustomShape;
  CD.drawDot = drawDot;
  CD.shapeFromSVG = shapeFromSVG;
  CD.SHAPE_TYPES = ['circle', 'square', 'diamond', 'line'];
})(CD);
