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

  /* A shape is a list of parts, not one merged path. Merging loses each
   * element's own paint: a subpath meant to punch a hole with fill-rule
   * evenodd fills solid under the default nonzero rule, and art defined by
   * stroke with no fill turns into a blob. A built-in is a single filled part,
   * so this is identical to v1 for every shape that ships with the tool. */
  function Shape(def) {
    this.parts = def.parts || [{ d: def.d, stroke: false, width: 0, rule: 'nonzero' }];
    this.d = this.parts[0].d;
    this.spin = def.spin !== false;
    this.round = !!def.round;
    /* normalisation applied *inside* the unit box: scale then recentre */
    this.nsx = def.nsx === undefined ? 1 : def.nsx;
    this.nsy = def.nsy === undefined ? 1 : def.nsy;
    this.cx = def.cx || 0;
    this.cy = def.cy || 0;
    this.name = def.name || 'shape';
    this._paths = null;
  }

  /* Lazily built Path2D per part, pre-normalised so callers only apply the
   * per-dot translate/rotate/scale. */
  Shape.prototype.paths = function () {
    if (this._paths) return this._paths;
    var self = this;
    var m = (typeof DOMMatrix !== 'undefined')
      ? new DOMMatrix().scaleSelf(this.nsx, this.nsy).translateSelf(-this.cx, -this.cy)
      : null;
    this._paths = this.parts.map(function (part) {
      var p = new Path2D();
      var inner = new Path2D(part.d);
      if (m) p.addPath(inner, m); else p.addPath(inner);
      return {
        p2d: p,
        stroke: part.stroke,
        /* stroke width is in the source file's units, and normalisation is
         * baked into the geometry, so it has to be scaled to match */
        width: part.width * self.nsx,
        rule: part.rule
      };
    });
    return this._paths;
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

  /* --------------------------------------------------------------------------
   * Node + link.
   *
   * Two more slots alongside the built-ins and the single Custom shape. Shape 1
   * lands every Nth step along a line and shape 2 fills the run between, so a
   * contour reads as marked points joined by a dotted rule. Either falls back
   * to a plain circle until an SVG is loaded into it.
   * ------------------------------------------------------------------------*/
  var PAIR_SLOTS = ['node', 'link'];

  function pairKey(slot) { return 'pair-' + slot; }
  function setPairShape(slot, shape) { registry[pairKey(slot)] = shape; }
  function hasPairShape(slot) { return !!registry[pairKey(slot)]; }

  function pairTypeFor(role) {
    var k = pairKey(role);
    return registry[k] ? k : 'circle';
  }

  /* The registry key one dot should be drawn with. Everything except node/link
   * mode uses the one shape the user picked, exactly as v1 did. */
  function shapeTypeForDot(p, dot) {
    if (p.shapeType !== 'nodes') return p.shapeType;
    return pairTypeFor(dot.role === 'node' ? 'node' : 'link');
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
    var parts = shape.paths();
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (part.stroke) {
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = part.width;
        ctx.stroke(part.p2d);
      } else {
        ctx.fill(part.p2d, part.rule);
      }
    }
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

  function parseInlineStyle(text) {
    var out = {};
    if (!text) return out;
    text.split(';').forEach(function (decl) {
      var i = decl.indexOf(':');
      if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
    });
    return out;
  }

  /* Resolve the paint that actually applies to an element, walking up through
   * ancestor <g>s — icon sets routinely set fill="none" stroke="currentColor"
   * once on a wrapper rather than on every child. */
  function paintOf(el) {
    var out = { fill: null, stroke: null, width: null, rule: null };
    var keys = { fill: 'fill', stroke: 'stroke', width: 'stroke-width', rule: 'fill-rule' };
    var node = el;
    while (node && node.nodeType === 1) {
      var st = parseInlineStyle(node.getAttribute('style'));
      Object.keys(keys).forEach(function (k) {
        if (out[k] !== null) return;
        var attr = keys[k];
        var v = st[attr] !== undefined ? st[attr] : node.getAttribute(attr);
        if (v !== null && v !== undefined && v !== '') out[k] = String(v).trim();
      });
      if (node.tagName && node.tagName.toLowerCase() === 'svg') break;
      node = node.parentNode;
    }
    return out;
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
      if (!d) continue;
      var paint = paintOf(nodes[i]);

      /* SVG defaults: fill black, stroke none. */
      var filled = !(paint.fill && paint.fill.toLowerCase() === 'none');
      var stroked = !!(paint.stroke && paint.stroke.toLowerCase() !== 'none');
      var sw = parseFloat(paint.width);
      if (!isFinite(sw) || sw <= 0) sw = 1;
      var rule = (paint.rule && paint.rule.toLowerCase() === 'evenodd') ? 'evenodd' : 'nonzero';

      if (filled) parts.push({ d: d, stroke: false, width: 0, rule: rule });
      if (stroked) parts.push({ d: d, stroke: true, width: sw, rule: rule });
    }
    if (!parts.length) {
      throw new Error('No visible shapes in that SVG — every element is fill="none" with no stroke.');
    }

    /* Measure with real, laid-out SVG nodes — the only reliable way to get a
     * bounding box for arbitrary path data. getBBox reports geometry only, so
     * a stroked part is inflated by half its width to cover the ink. */
    var probe = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    probe.setAttribute('width', '10'); probe.setAttribute('height', '10');
    probe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;opacity:0';
    document.body.appendChild(probe);
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    try {
      for (var j = 0; j < parts.length; j++) {
        var pe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pe.setAttribute('d', parts[j].d);
        probe.appendChild(pe);
        var b = pe.getBBox();
        var pad = parts[j].stroke ? parts[j].width / 2 : 0;
        if (b.width || b.height || pad) {
          x0 = Math.min(x0, b.x - pad); y0 = Math.min(y0, b.y - pad);
          x1 = Math.max(x1, b.x + b.width + pad); y1 = Math.max(y1, b.y + b.height + pad);
        }
      }
    } finally { document.body.removeChild(probe); }

    if (!isFinite(x0) || x1 <= x0 || y1 <= y0) {
      throw new Error('That SVG has no measurable area.');
    }
    var bb = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };

    /* Fit the longest side into the unit box, keeping aspect ratio. */
    var s = 2 / Math.max(bb.width, bb.height);
    var shape = new Shape({
      parts: parts,
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
  CD.setPairShape = setPairShape;
  CD.hasPairShape = hasPairShape;
  CD.shapeTypeForDot = shapeTypeForDot;
  CD.PAIR_SLOTS = PAIR_SLOTS;
  CD.hasCustomShape = hasCustomShape;
  CD.drawDot = drawDot;
  CD.shapeFromSVG = shapeFromSVG;
  CD.SHAPE_TYPES = ['circle', 'square', 'diamond', 'line'];
})(CD);
