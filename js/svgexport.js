/* ============================================================================
 * svgexport.js — vector export of exactly what is on the canvas.
 *
 * The shape is emitted once into <defs> and every dot is a <use> carrying its
 * own translate/rotate/scale, so the file stays small and stays editable:
 * in Illustrator or Figma each dot is still a real object, and swapping the
 * single definition in <defs> restyles every dot at once.
 *
 * Circles take a shorter path — a plain <circle>, which is both smaller and
 * friendlier to downstream tools.
 *
 * When the glow is on, the dot layer is emitted into <defs> once and drawn
 * twice with <use>: a blurred copy underneath, the crisp one on top. Emitting
 * the dots twice would double the file for no reason.
 * ==========================================================================*/
var CD = window.CD || {};

(function (CD) {
  'use strict';

  var DEG = 180 / Math.PI;

  function num(v, dp) {
    var m = Math.pow(10, dp === undefined ? 2 : dp);
    var r = Math.round(v * m) / m;
    return (r === 0 ? 0 : r).toString();
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* Append in place. Not push.apply: the dot layer runs to six figures of
   * entries, and spreading that many arguments overflows the call stack. */
  function pushAll(dst, src) {
    for (var i = 0; i < src.length; i++) dst.push(src[i]);
  }

  /* opts: {width, height, background, dots, shapeType, ramp, colorGamma,
   *        glowAmount, glowRadius, toneSplitLow, toneSplitHigh, title,
   *        buckets} */
  function buildSVG(opts) {
    var w = opts.width, h = opts.height;
    var dots = opts.dots;
    var ramp = opts.ramp;
    var gamma = opts.colorGamma;
    var buckets = opts.buckets || 24;

    var out = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>');
    out.push('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
      'width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">');
    out.push('<title>' + esc(opts.title || 'Contour dot render') + '</title>');
    out.push('<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="' + opts.background + '"/>');

    var glow = opts.glowAmount > 0.001 && opts.glowRadius > 0.001;
    var toneMode = opts.shapeType === 'tones';

    /* Shapes are emitted into <defs> on demand: in tone mode a render can use
     * up to three different primitives, and only the ones actually placed
     * should end up in the file. */
    var defs = [];
    var used = {};

    function defIdFor(type) {
      if (!used[type]) {
        var sh = CD.getShape(type);
        var id = 'dot-' + type;
        var nt = sh.normTransform();
        defs.push(nt
          ? '<g id="' + id + '" transform="' + nt + '"><path d="' + sh.d + '"/></g>'
          : '<path id="' + id + '" d="' + sh.d + '"/>');
        used[type] = id;
      }
      return used[type];
    }

    /* Group dots into a small number of colour buckets so the file is a
     * handful of <g fill> groups rather than one fill attribute per dot. */
    var body = [];
    var groups = [];
    var i;
    for (i = 0; i < buckets; i++) groups.push([]);
    for (i = 0; i < dots.length; i++) {
      var bi = Math.min(buckets - 1, Math.max(0, Math.floor(dots[i].d * buckets)));
      groups[bi].push(dots[i]);
    }

    for (var g = 0; g < buckets; g++) {
      var list = groups[g];
      if (!list.length) continue;
      var mid = (g + 0.5) / buckets;
      var col = CD.rgbToHex(ramp(mid, gamma));
      body.push('<g fill="' + col + '">');
      for (i = 0; i < list.length; i++) {
        var dt = list[i];
        var type = toneMode ? CD.shapeTypeForDepth(opts, dt.d) : opts.shapeType;
        var sh = CD.getShape(type);

        if (sh.round && !sh.custom) {
          /* a circle is shorter and more portable as a real <circle> */
          body.push('<circle cx="' + num(dt.x) + '" cy="' + num(dt.y) +
                    '" r="' + num(dt.s, 3) + '"/>');
        } else {
          var id = defIdFor(type);
          var t = 'translate(' + num(dt.x) + ' ' + num(dt.y) + ')';
          if (sh.spin) {
            var deg = dt.r * DEG;
            /* squares and diamonds repeat every 90 degrees; folding the angle
             * into a short range keeps the numbers small */
            if (type === 'square' || type === 'diamond') {
              deg = ((deg % 90) + 90) % 90;
            }
            t += ' rotate(' + num(deg, 1) + ')';
          }
          t += ' scale(' + num(dt.s, 3) + ')';
          body.push('<use xlink:href="#' + id + '" href="#' + id +
                    '" transform="' + t + '"/>');
        }
      }
      body.push('</g>');
    }

    if (glow) {
      /* userSpaceOnUse with an explicit margin: the default bounding-box
       * filter region would clip a blur this wide at the edges of the art. */
      var pad = Math.ceil(opts.glowRadius * 3);
      defs.push('<filter id="glow" filterUnits="userSpaceOnUse" ' +
        'x="' + (-pad) + '" y="' + (-pad) + '" ' +
        'width="' + (w + pad * 2) + '" height="' + (h + pad * 2) + '">' +
        '<feGaussianBlur stdDeviation="' + num(opts.glowRadius / 2, 2) + '"/>' +
        '</filter>');
      defs.push('<g id="dots">');
      pushAll(defs, body);
      defs.push('</g>');
    }
    if (defs.length) {
      out.push('<defs>');
      pushAll(out, defs);
      out.push('</defs>');
    }
    if (glow) {
      out.push('<use xlink:href="#dots" href="#dots" filter="url(#glow)" ' +
               'opacity="' + num(opts.glowAmount, 3) + '"/>');
      out.push('<use xlink:href="#dots" href="#dots"/>');
    } else {
      pushAll(out, body);
    }

    out.push('</svg>');
    return out.join('\n');
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  CD.buildSVG = buildSVG;
  CD.download = download;
})(CD);
