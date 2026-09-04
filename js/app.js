/* ============================================================================
 * app.js — p5 sketch + pipeline orchestration.
 *
 * Pipeline, in dependency order. A control only dirties its own stage and
 * everything downstream of it, so dragging a dot slider never re-traces the
 * contours and never rebuilds the depth field.
 *
 *   depth  ->  flow  ->  lines  ->  dots  ->  draw
 * ==========================================================================*/
var CD = window.CD || {};

(function (CD) {
  'use strict';

  var VIEW_MAX = 900;    // long side of the render canvas, in CSS px
  var FIELD_MAX = 420;   // long side of the analysis grid

  var STAGES = CD.UI.STAGES;

  var state = {
    params: CD.UI.defaults(),
    srcCanvas: null,     // full-res source image on a canvas
    srcName: 'sample',
    viewW: 700, viewH: 700,
    fieldW: 0, fieldH: 0, fieldScale: 1,
    dep: null, flow: null, sd: null, lines: [], dots: [],
    pendingShapeSlot: null,
    dirty: 'depth',
    pendingFull: null,
    quality: 'full',
    busy: false,
    timing: {}
  };

  var ui = null;
  var canvasEl = null;
  var ctx = null;
  var draftTimer = null, fullTimer = null;

  /* ==========================================================================
   * Source image
   * ========================================================================*/

  /* A procedural stand-in so the tool renders something the moment it opens.
   *
   * It is deliberately a *shaded render* rather than a clean depth map: a
   * surface built from overlapping ellipsoids, lit from the upper left, which
   * is what an actual photograph looks like going in. The pipeline then has to
   * recover depth from luminance exactly as it does for a real portrait. */
  function makeSampleImage() {
    var w = 700, h = 900;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    var img = g.createImageData(w, h);
    var px = img.data;

    /* [cx, cy, rx, ry, height] in normalised coordinates */
    var lobes = [
      [0.50, 0.38, 0.33, 0.28, 1.00],   // cranium
      [0.50, 0.58, 0.27, 0.21, 0.90],   // cheeks
      [0.52, 0.49, 0.07, 0.15, 1.17],   // nose ridge
      [0.38, 0.32, 0.12, 0.06, 0.95],   // brow, left
      [0.63, 0.32, 0.12, 0.06, 0.95],   // brow, right
      [0.51, 0.64, 0.10, 0.05, 0.93],   // lips
      [0.50, 0.74, 0.14, 0.09, 0.75],   // chin
      [0.50, 0.87, 0.21, 0.15, 0.55]    // neck
    ];

    function height(u, v) {
      var z = 0;
      for (var i = 0; i < lobes.length; i++) {
        var L = lobes[i];
        var a = (u - L[0]) / L[2], b = (v - L[1]) / L[3];
        var r2 = a * a + b * b;
        if (r2 < 1) {
          var hgt = Math.sqrt(1 - r2) * L[4];
          /* smooth max, so the lobes fuse into one surface rather than
           * meeting at a crease */
          var hi = z > hgt ? z : hgt, lo = z > hgt ? hgt : z;
          z = hi + 0.08 * Math.exp(-(hi - lo) / 0.08);
        }
      }
      return z;
    }

    /* key light, upper left, slightly in front */
    var lx = -0.55, ly = -0.45, lz = 0.70;
    var ll = Math.hypot(lx, ly, lz);
    lx /= ll; ly /= ll; lz /= ll;

    var e = 1 / w;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var u = x / w, v = y / h;
        var val = 0;
        if (height(u, v) > 0.001) {
          /* surface normal by central difference, then Lambert plus a touch
           * of specular so the highlights sit where a real key light puts
           * them */
          var nx = -(height(u + e, v) - height(u - e, v)) / (2 * e) * 0.06;
          var ny = -(height(u, v + e) - height(u, v - e)) / (2 * e) * 0.06;
          var nl = Math.hypot(nx, ny, 1);
          var lam = Math.max(0, (nx / nl) * lx + (ny / nl) * ly + (1 / nl) * lz);
          val = Math.min(1, lam * 0.88 + Math.pow(lam, 22) * 0.45 + 0.03);
        }
        var k = (y * w + x) * 4;
        px[k] = Math.round(val * 255);
        px[k + 1] = Math.round(val * 236);
        px[k + 2] = Math.round(val * 220);
        px[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  function setSource(canvas, name) {
    state.srcCanvas = canvas;
    state.srcName = name || 'image';

    var ar = canvas.width / canvas.height;
    if (ar >= 1) { state.viewW = VIEW_MAX; state.viewH = Math.round(VIEW_MAX / ar); }
    else { state.viewH = VIEW_MAX; state.viewW = Math.round(VIEW_MAX * ar); }

    if (ar >= 1) { state.fieldW = FIELD_MAX; state.fieldH = Math.max(8, Math.round(FIELD_MAX / ar)); }
    else { state.fieldH = FIELD_MAX; state.fieldW = Math.max(8, Math.round(FIELD_MAX * ar)); }
    state.fieldScale = state.fieldW / state.viewW;

    if (typeof resizeCanvas === 'function' && canvasEl) {
      resizeCanvas(state.viewW, state.viewH);
    }
    markDirty('depth');
  }

  function loadImageFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      status('That file is not an image.', true);
      return;
    }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var c = document.createElement('canvas');
      /* keep a sane working copy; the analysis grid is far smaller anyway */
      var max = 1600;
      var sc = Math.min(1, max / Math.max(img.width, img.height));
      c.width = Math.max(1, Math.round(img.width * sc));
      c.height = Math.max(1, Math.round(img.height * sc));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      setSource(c, file.name.replace(/\.[^.]+$/, ''));
      status('Loaded ' + file.name);
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      status('Could not decode that image.', true);
    };
    img.src = url;
  }

  /* ==========================================================================
   * Pipeline stages
   * ========================================================================*/

  function stageDepth(p) {
    var fw = state.fieldW, fh = state.fieldH;
    var c = document.createElement('canvas');
    c.width = fw; c.height = fh;
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(state.srcCanvas, 0, 0, fw, fh);
    var px = g.getImageData(0, 0, fw, fh).data;
    state.dep = CD.buildDepth(px, fw, fh, p);
  }

  function stageFlow(p) {
    /* Edge mode takes its direction from the extracted contour's own tangent,
     * so there is no field to build. */
    if (p.renderMode === 'edge') { state.flow = null; return; }
    state.flow = CD.buildFlow(state.dep, p, function (x, y) {
      return (typeof noise === 'function') ? noise(x, y) : 0.5;
    });
  }

  function stageLines(p) {
    if (p.renderMode === 'edge') {
      var built = CD.buildEdgeLines({
        dep: state.dep,
        params: p,
        fieldScale: state.fieldScale
      });
      state.lines = built.lines;
      state.sd = built.sd;
      return;
    }

    var tracer = new CD.Tracer({
      flow: state.flow,
      depth: state.dep.depth,
      mask: state.dep.mask,
      viewW: state.viewW, viewH: state.viewH,
      fieldScale: state.fieldScale,
      params: p,
      rng: CD.makeRng(p.seed)
    });
    /* The tracer yields bare polylines; the dot builder takes banded lines. */
    state.lines = tracer.run().map(function (pts) {
      return { pts: pts, band: 0 };
    });
  }

  function stageDots(p) {
    var edgeMode = p.renderMode === 'edge';
    state.dots = CD.buildDots({
      lines: state.lines,
      depth: state.dep.depth,
      grad: state.dep.grad,
      mask: state.dep.mask,
      edge: state.dep.edge,
      flow: state.flow,
      fieldScale: state.fieldScale,
      params: p,
      rng: CD.makeRng(p.seed ^ 0x9e3779b9),
      /* Edge mode reads the picture's tonality rather than its depth: that is
       * what gates the bands, tints the dots and picks the tone shapes. Dots
       * are also evenly spaced along each contour — the density in the darks
       * comes from stacking more bands, not from crowding one. */
      valueField: edgeMode ? state.dep.tone : state.dep.depth,
      uniformSpacing: edgeMode,
      bandLimit: edgeMode ? CD.makeBandLimit(state.dep.tone, p) : null
    });
  }

  /* Paint every dot. One flat colour, so there is a single fillStyle for the
   * whole render and no bucketing to do. */
  function paintDots(c2d) {
    var p = state.params;
    CD.applyFit(p.shapeFit ? 'box' : 'ink');
    var dots = state.dots;
    c2d.fillStyle = p.dotColor;
    for (var i = 0; i < dots.length; i++) {
      var d = dots[i];
      CD.drawDot(c2d, d.x, d.y, d.s, d.r, CD.shapeTypeForDot(p, d));
    }
  }

  function stageDraw() {
    var p = state.params;
    if (!ctx) return;

    ctx.save();
    ctx.fillStyle = p.background;
    ctx.fillRect(0, 0, state.viewW, state.viewH);
    ctx.restore();

    /* The source photograph sits under the dots: the contours are an overlay
     * that identifies the subject, not a replacement for it. */
    if (p.showImage && state.srcCanvas) {
      ctx.save();
      ctx.drawImage(state.srcCanvas, 0, 0, state.viewW, state.viewH);
      ctx.restore();
    }

    ctx.save();
    paintDots(ctx);
    ctx.restore();
  }

  /* ==========================================================================
   * Scheduling
   * ========================================================================*/

  function markDirty(stage) {
    state.dirty = CD.UI.earliest(state.dirty, stage);
    state.pendingFull = CD.UI.earliest(state.pendingFull, stage);
    schedule();
  }

  function schedule() {
    clearTimeout(draftTimer);
    clearTimeout(fullTimer);
    draftTimer = setTimeout(function () { run('draft'); }, 55);
    fullTimer = setTimeout(function () { run('full'); }, 320);
  }

  /* Draft quality trades line and dot count for responsiveness while a slider
   * is moving; the full pass follows once the user stops. */
  function draftParams(p) {
    var q = {};
    Object.keys(p).forEach(function (k) { q[k] = p[k]; });
    q.lineSpacing = p.lineSpacing * 1.8;
    q.dotSpacing = p.dotSpacing * 1.5;
    q.maxPoints = Math.min(p.maxPoints, 220000);
    q.maxDots = Math.min(p.maxDots, 40000);
    q.maxLines = Math.min(p.maxLines, 1400);
    return q;
  }

  function run(quality) {
    if (!state.srcCanvas) return;
    var from = quality === 'draft' ? state.dirty : state.pendingFull;
    if (!from) return;

    /* The draft pass already produced correct depth and flow (it only shrinks
     * line and dot counts), so the full pass restarts at the line stage. */
    if (quality === 'full' && state.quality === 'draft' &&
        STAGES.indexOf(from) < STAGES.indexOf('lines')) {
      from = 'lines';
    }

    var p = quality === 'draft' ? draftParams(state.params) : state.params;
    var i0 = STAGES.indexOf(from);
    var t0 = performance.now();

    try {
      if (i0 <= 0) stageDepth(p);
      if (i0 <= 1) stageFlow(p);
      if (i0 <= 2) stageLines(p);
      if (i0 <= 3) stageDots(p);
      stageDraw();
    } catch (e) {
      console.error(e);
      status('Render failed: ' + e.message, true);
      return;
    }

    state.timing[quality] = performance.now() - t0;
    state.quality = quality;
    if (quality === 'draft') {
      state.dirty = null;
    } else {
      state.dirty = null;
      state.pendingFull = null;
    }
    updateStats(quality);
  }

  /* ==========================================================================
   * Chrome
   * ========================================================================*/

  function $(sel) { return document.querySelector(sel); }

  function status(msg, isError) {
    var e = $('#status');
    if (!e) return;
    e.textContent = msg;
    e.classList.toggle('error', !!isError);
  }

  function updateStats(quality) {
    var e = $('#stats');
    if (!e) return;
    e.textContent = state.lines.length.toLocaleString() + ' contours · ' +
      state.dots.length.toLocaleString() + ' dots · ' +
      Math.round(state.timing[quality] || 0) + ' ms' +
      (quality === 'draft' ? ' (preview)' : '');
  }

  /* The source photograph as a data URI, so an exported SVG is self-contained
   * rather than referencing a file the recipient does not have. JPEG because a
   * lossless copy of a photograph would dwarf the vector payload. */
  function imageDataURL() {
    try {
      return state.srcCanvas.toDataURL('image/jpeg', 0.88);
    } catch (e) {
      return null;
    }
  }

  function exportSVG() {
    if (!state.dots.length) { status('Nothing to export yet.', true); return; }
    if (state.pendingFull || state.quality !== 'full') {
      clearTimeout(fullTimer);
      run('full');
    }
    var p = state.params;
    CD.applyFit(p.shapeFit ? 'box' : 'ink');
    var svg = CD.buildSVG({
      width: state.viewW, height: state.viewH,
      background: p.background,
      dots: state.dots,
      color: p.dotColor,
      params: p,
      /* Whatever is on the canvas is what gets written: with the image hidden
       * there is nothing to embed. */
      image: (p.showImage && state.srcCanvas) ? imageDataURL() : null,
      title: state.srcName + ' — contour dots'
    });
    CD.download(state.srcName + '-contour-dots.svg', svg);
    status('Exported SVG · ' + (svg.length / 1048576).toFixed(2) + ' MB · ' +
           state.dots.length.toLocaleString() + ' vector dots');
  }

  function exportPNG() {
    if (!canvasEl) return;
    canvasEl.toBlob(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = state.srcName + '-contour-dots.png';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }, 'image/png');
    status('Exported PNG');
  }

  function wireChrome() {
    var imgInput = $('#imageInput');
    var shapeInput = $('#shapeInput');

    $('#loadImage').addEventListener('click', function () { imgInput.click(); });
    imgInput.addEventListener('change', function () {
      loadImageFile(imgInput.files[0]);
      imgInput.value = '';
    });

    shapeInput.addEventListener('change', function () {
      var f = shapeInput.files[0];
      /* A drop carries no slot, so it fills the first empty one — shape 1
       * before shape 2 — and otherwise replaces shape 1. */
      var slot = state.pendingShapeSlot ||
        (CD.hasPairShape('node') && !CD.hasPairShape('link') ? 'link' : 'node');
      state.pendingShapeSlot = null;
      shapeInput.value = '';
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var shape = CD.shapeFromSVG(fr.result, f.name);
          CD.setPairShape(slot, shape);
          if (ui.refs.__shapes.loaded) ui.refs.__shapes.loaded(slot, f.name);
          markDirty('draw');
          status('Shape ' + (slot === 'node' ? '1' : '2') + ' set from ' + f.name);
        } catch (e) {
          status(e.message, true);
        }
      };
      fr.onerror = function () { status('Could not read that file.', true); };
      fr.readAsText(f);
    });

    $('#exportSvg').addEventListener('click', exportSVG);
    $('#exportPng').addEventListener('click', exportPNG);

    $('#reseed').addEventListener('click', function () {
      state.params.seed = (Math.random() * 0xffffffff) >>> 0;
      markDirty('lines');
    });

    $('#reset').addEventListener('click', function () {
      /* Copy the defaults *into* the existing params object rather than
       * replacing it. Every control closure in the panel holds a reference to
       * this exact object; swapping it out orphans all of them and silently
       * makes the whole panel inert. */
      var defaults = CD.UI.defaults();
      var seed = state.params.seed;
      Object.keys(defaults).forEach(function (k) { state.params[k] = defaults[k]; });
      state.params.seed = seed;
      ui.syncAll();
      markDirty('depth');
      status('Controls reset');
    });

    /* drag & drop: images set the source, SVGs set the dot shape */
    var stage = $('#stage');
    ['dragenter', 'dragover'].forEach(function (ev) {
      stage.addEventListener(ev, function (e) {
        e.preventDefault(); stage.classList.add('drop');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      stage.addEventListener(ev, function (e) {
        e.preventDefault(); stage.classList.remove('drop');
      });
    });
    stage.addEventListener('drop', function (e) {
      var f = e.dataTransfer.files[0];
      if (!f) return;
      if (/svg/.test(f.type) || /\.svg$/i.test(f.name)) {
        /* Clear any slot a cancelled picker left pending, so a drop cannot be
         * captured by it. */
        state.pendingShapeSlot = null;
        var dt = new DataTransfer();
        dt.items.add(f);
        shapeInput.files = dt.files;
        shapeInput.dispatchEvent(new Event('change'));
      } else {
        loadImageFile(f);
      }
    });

    $('#panelToggle').addEventListener('click', function () {
      document.body.classList.toggle('panel-hidden');
    });
  }

  /* ==========================================================================
   * p5 entry points (global mode)
   * ========================================================================*/

  window.setup = function () {
    var holder = document.getElementById('canvasHolder');
    var c = createCanvas(state.viewW, state.viewH);
    c.parent(holder);
    canvasEl = c.elt;
    ctx = canvasEl.getContext('2d');
    pixelDensity(Math.min(2, window.devicePixelRatio || 1));
    noiseSeed(1337);
    noiseDetail(3, 0.5);
    noLoop();

    ui = CD.UI.buildPanel(document.getElementById('controls'), state.params,
      function (stage) {
        if (ui) ui.syncVisibility();
        markDirty(stage);
      },
      { pickShape: function (slot) {
          state.pendingShapeSlot = slot || null;
          document.getElementById('shapeInput').click();
        } });

    wireChrome();
    setSource(makeSampleImage(), 'sample');
    status('Drop an image anywhere, or load one. Drop an SVG to set the dot shape.');
  };

  window.windowResized = function () { /* canvas is CSS-scaled; nothing to do */ };

  CD.state = state;
})(CD);
