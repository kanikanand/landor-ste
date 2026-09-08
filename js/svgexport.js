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

  /* opts: {width, height, background, dots, shapeType, ramp, colorGamma,
   *        title, buckets} */
  function buildSVG(opts) {
    var w = opts.width, h = opts.height;
    var shape = CD.getShape(opts.shapeType);
    var dots = opts.dots;
    var ramp = opts.ramp;
    var gamma = opts.colorGamma;
    var buckets = opts.buckets || CD.COLOR_BUCKETS;
    var isCircle = shape.round && !shape.custom;

    var out = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>');
    out.push('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
      'width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">');
    out.push('<title>' + esc(opts.title || 'Contour dot render') + '</title>');
    out.push('<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="' + opts.background + '"/>');

    if (!isCircle) {
      var nt = shape.normTransform();
      out.push('<defs>');
      if (nt) {
        out.push('<g id="dot" transform="' + nt + '"><path d="' + shape.d + '"/></g>');
      } else {
        out.push('<path id="dot" d="' + shape.d + '"/>');
      }
      out.push('</defs>');
    }

    /* Group dots into a small number of colour-and-opacity buckets so the file
     * is a handful of <g fill> groups rather than an attribute pair per dot.
     * This is the bucketing the canvas uses, called from the same place, so
     * the export cannot drift away from what you saw. */
    var abuckets = CD.ALPHA_BUCKETS;
    var groups = [];
    var i;
    for (i = 0; i < dots.length; i++) {
      var k = CD.bucketOf(dots[i], buckets, abuckets);
      (groups[k] || (groups[k] = [])).push(dots[i]);
    }

    for (var g = 0; g < buckets * abuckets; g++) {
      var list = groups[g];
      if (!list) continue;
      var cb = (g / abuckets) | 0, ab = g % abuckets;
      var mid = (cb + 0.5) / buckets;
      var col = CD.rgbToHex(ramp(mid, gamma));
      var op = abuckets > 1 ? ab / (abuckets - 1) : 1;
      out.push('<g fill="' + col + '"' +
               (op < 1 ? ' fill-opacity="' + num(op, 3) + '"' : '') + '>');
      for (i = 0; i < list.length; i++) {
        var dt = list[i];
        if (isCircle) {
          out.push('<circle cx="' + num(dt.x) + '" cy="' + num(dt.y) +
                   '" r="' + num(dt.s, 3) + '"/>');
        } else {
          var t = 'translate(' + num(dt.x) + ' ' + num(dt.y) + ')';
          if (shape.spin) {
            var deg = dt.r * DEG;
            /* squares and diamonds repeat every 90 degrees; folding the angle
             * into a short range keeps the numbers small */
            if (opts.shapeType === 'square' || opts.shapeType === 'diamond') {
              deg = ((deg % 90) + 90) % 90;
            }
            t += ' rotate(' + num(deg, 1) + ')';
          }
          t += ' scale(' + num(dt.s, 3) + ')';
          out.push('<use xlink:href="#dot" href="#dot" transform="' + t + '"/>');
        }
      }
      out.push('</g>');
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

  /* The zip path already has a Blob; the text path wraps one. */
  function downloadBlob(filename, blob) {
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
  CD.downloadBlob = downloadBlob;
})(CD);
