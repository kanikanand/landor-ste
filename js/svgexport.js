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

  /* opts: {width, height, background, image, dots, ramp, colorGamma,
   *        params, title, buckets} */
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
    /* The photograph rides along only when it is on screen, so the file holds
     * exactly what the canvas showed. */
    if (opts.image) {
      out.push('<image x="0" y="0" width="' + w + '" height="' + h +
               '" preserveAspectRatio="none" xlink:href="' + opts.image +
               '" href="' + opts.image + '"/>');
    }

    /* Shapes go into <defs> on demand as dots reference them. One shape for
     * every mode except node/link, which places two. */
    var defs = [];
    var used = {};

    function defIdFor(type) {
      if (!used[type]) {
        var sh = CD.getShape(type);
        var id = 'dot-' + type;
        var nt = sh.normTransform();
        /* Each part keeps its own paint. Stroked parts take their colour from
         * `currentColor`, which the enclosing colour group sets alongside
         * fill, so one group still drives every dot in a bucket. */
        var inner = sh.parts.map(function (part) {
          if (part.stroke) {
            return '<path d="' + part.d + '" fill="none" stroke="currentColor" ' +
                   'stroke-width="' + num(part.width, 3) + '"/>';
          }
          return '<path d="' + part.d + '"' +
                 (part.rule === 'evenodd' ? ' fill-rule="evenodd"' : '') + '/>';
        }).join('');
        defs.push('<g id="' + id + '"' + (nt ? ' transform="' + nt + '"' : '') +
                  '>' + inner + '</g>');
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
      var b = Math.min(buckets - 1, Math.max(0, Math.floor(dots[i].d * buckets)));
      groups[b].push(dots[i]);
    }

    for (var g = 0; g < buckets; g++) {
      var list = groups[g];
      if (!list.length) continue;
      var mid = (g + 0.5) / buckets;
      var col = CD.rgbToHex(ramp(mid, gamma));
      body.push('<g fill="' + col + '" color="' + col + '">');
      for (i = 0; i < list.length; i++) {
        var dt = list[i];
        var type = CD.shapeTypeForDot(opts.params, dt);
        var shape = CD.getShape(type);
        if (shape.round && !shape.custom) {
          /* a circle is shorter and more portable as a real <circle> */
          body.push('<circle cx="' + num(dt.x) + '" cy="' + num(dt.y) +
                    '" r="' + num(dt.s, 3) + '"/>');
        } else {
          var id = defIdFor(type);
          var t = 'translate(' + num(dt.x) + ' ' + num(dt.y) + ')';
          if (shape.spin) {
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

    if (defs.length) {
      out.push('<defs>');
      for (i = 0; i < defs.length; i++) out.push(defs[i]);
      out.push('</defs>');
    }
    for (i = 0; i < body.length; i++) out.push(body[i]);

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
