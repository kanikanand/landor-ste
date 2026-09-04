/* ============================================================================
 * svgexport.js — vector export of exactly what is on the canvas.
 *
 * The shape is emitted once into <defs> and every dot is a <use> carrying its
 * own translate/rotate/scale, so the file stays small and stays editable:
 * in Illustrator or Figma each dot is still a real object, and swapping the
 * single definition in <defs> restyles every dot at once.
 *
 * The built-in ellipse takes a shorter path — a plain <circle>, which is both
 * smaller and friendlier to downstream tools.
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

  /* opts: {width, height, background, dots, color, params, image, title} */
  function buildSVG(opts) {
    var w = opts.width, h = opts.height;
    var dots = opts.dots;

    var out = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>');
    out.push('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
      'width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">');
    out.push('<title>' + esc(opts.title || 'Contour dot render') + '</title>');
    out.push('<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="' + opts.background + '"/>');
    if (opts.image) {
      /* The photograph, embedded so the file stands alone, underneath the
       * dots exactly as on the canvas. */
      out.push('<image x="0" y="0" width="' + w + '" height="' + h + '"' +
        ' preserveAspectRatio="none"' +
        ' xlink:href="' + opts.image + '" href="' + opts.image + '"/>');
    }

    /* Shapes are emitted into <defs> on demand as dots reference them, so a
     * render carries exactly the definitions it uses and nothing more. */
    var defs = [];
    var used = {};

    function defIdFor(type) {
      if (!used[type]) {
        var sh = CD.getShape(type);
        var id = 'dot-' + type;
        var nt = sh.normTransform();
        /* Each part keeps its own paint. Stroked parts take their colour from
         * `currentColor`, which the enclosing group sets alongside fill. */
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

    /* One flat colour, so the whole render is a single group. */
    var body = [];
    body.push('<g fill="' + opts.color + '" color="' + opts.color + '">');
    for (var i = 0; i < dots.length; i++) {
      var dt = dots[i];
      var type = CD.shapeTypeForDot(opts.params, dt);
      var sh = CD.getShape(type);

      if (sh.round && !sh.custom) {
        /* an ellipse is shorter and more portable as a real <circle> */
        body.push('<circle cx="' + num(dt.x) + '" cy="' + num(dt.y) +
                  '" r="' + num(dt.s, 3) + '"/>');
      } else {
        var id = defIdFor(type);
        var t = 'translate(' + num(dt.x) + ' ' + num(dt.y) + ')';
        if (sh.spin) t += ' rotate(' + num(dt.r * DEG, 1) + ')';
        t += ' scale(' + num(dt.s, 3) + ')';
        body.push('<use xlink:href="#' + id + '" href="#' + id +
                  '" transform="' + t + '"/>');
      }
    }
    body.push('</g>');

    if (defs.length) {
      out.push('<defs>');
      pushAll(out, defs);
      out.push('</defs>');
    }
    pushAll(out, body);

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
