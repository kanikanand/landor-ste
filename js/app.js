/* ============================================================================
 * app.js — p5 sketch + pipeline orchestration.
 *
 * Three modes read the same photograph and draw three different things from
 * it. Each one carries its own threshold and contrast, so each gets its own
 * depth field: the surface wants a soft, smoothed field it can run contours
 * across, the edge wants a hard silhouette, the fingerprint wants only the
 * ground the subject stands against. They then share one dot walker and one
 * pair of shapes, and land in one list of dots.
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
  var MODES = CD.UI.MODES;

  var state = {
    params: CD.UI.defaults(),
    srcCanvas: null,     // full-res source image on a canvas
    srcName: 'sample',
    viewW: 700, viewH: 700,
    fieldW: 0, fieldH: 0, fieldScale: 1,
    px: null,            // the source resampled onto the analysis grid
    deps: {},            // depth field per active mode
    masks: {},           // silhouette per mode that needs one
    flow: null,
    lines: {},           // polylines per active mode
    dots: [],
    lineCount: 0,
    pendingShapeSlot: null,
    shapeNames: {},
    ramp: null,
    dirty: 'depth',
    pendingFull: null,
    quality: 'full',
    timing: {}
  };

  var ui = null;
  var canvasEl = null;
  var ctx = null;
  var draftTimer = null, fullTimer = null;

  function noise2D(x, y) {
    return (typeof noise === 'function') ? noise(x, y) : 0.5;
  }

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

  /* Each active mode gets its own depth field, because each carries its own
   * threshold and contrast. Two modes set to the same pair of values do the
   * same work twice, which at this grid size is a couple of milliseconds and
   * not worth the cache. */
  function stageDepth(p) {
    var fw = state.fieldW, fh = state.fieldH;
    var c = document.createElement('canvas');
    c.width = fw; c.height = fh;
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(state.srcCanvas, 0, 0, fw, fh);
    state.px = g.getImageData(0, 0, fw, fh).data;

    state.deps = {};
    CD.UI.activeModes(p).forEach(function (mode) {
      state.deps[mode] = CD.buildDepth(state.px, fw, fh, CD.UI.modeParams(p, mode));
    });
  }

  function stageFlow(p) {
    /* Only the surface renderer runs a flow field. The other two take their
     * direction from the tangent of the contour they extracted. */
    if (!p.surfaceOn || !state.deps.surface) { state.flow = null; return; }
    state.flow = CD.buildFlow(state.deps.surface, CD.UI.modeParams(p, 'surface'), noise2D);
  }

  /* The silhouette a mode traces: the background flooded in from the frame,
   * everything it cannot reach kept as the subject, specks dropped and holes
   * filled. Falls back to the plain luminance cut if the flood is
   * degenerate. */
  function silhouette(mode, mp) {
    var dep = state.deps[mode];
    var subj = CD.subjectMask(dep.tone, mp) || dep.mask;
    return CD.buildEdgeMask(subj, mp);
  }

  function stageLines(p) {
    state.lines = {};
    state.masks = {};

    if (p.surfaceOn && state.deps.surface) {
      var mp = CD.UI.modeParams(p, 'surface');
      var dep = state.deps.surface;
      var tracer = new CD.Tracer({
        flow: state.flow,
        depth: dep.depth,
        mask: dep.mask,
        viewW: state.viewW, viewH: state.viewH,
        fieldScale: state.fieldScale,
        params: mp,
        rng: CD.makeRng(mp.seed)
      });
      /* The tracer yields bare polylines; the dot builder takes tagged ones. */
      var traced = tracer.run();
      var surf = [];
      for (var j = 0; j < traced.length; j++) surf.push({ pts: traced[j], kind: 'surface' });
      state.lines.surface = surf;
    }

    if (p.edgeOn && state.deps.edge) {
      var emp = CD.UI.modeParams(p, 'edge');
      state.masks.edge = silhouette('edge', emp);
      var built = CD.buildEdgeLines({ mask: state.masks.edge, fieldScale: state.fieldScale });
      var edge = [];
      for (var k = 0; k < built.lines.length; k++) {
        edge.push({ pts: built.lines[k].pts, kind: 'edge' });
      }
      state.lines.edge = edge;
    }

    if (p.fingerprintOn && state.deps.fingerprint) {
      var fmp = CD.UI.modeParams(p, 'fingerprint');
      state.masks.fingerprint = silhouette('fingerprint', fmp);
      var ridges = CD.buildFingerprintLines({
        mask: state.masks.fingerprint,
        params: fmp,
        fieldScale: state.fieldScale,
        noise2D: noise2D
      });
      var fp = [];
      for (var q = 0; q < ridges.lines.length; q++) {
        fp.push({ pts: ridges.lines[q].pts, kind: 'fingerprint' });
      }
      state.lines.fingerprint = fp;
    }

    state.lineCount = MODES.reduce(function (n, m) {
      return n + (state.lines[m] ? state.lines[m].length : 0);
    }, 0);
  }

  /* Where each mode's marks are allowed to land. Surface passes nothing and
   * gets the silhouette test it has always had; the edge draws its one line
   * end to end; the fingerprint stays out in the background. */
  function gateFor(mode) {
    if (mode === 'edge') return function () { return true; };
    if (mode === 'fingerprint') {
      var m = state.masks.fingerprint;
      return function (fx, fy) { return m.sample(fx, fy, 0) <= 0.5; };
    }
    return null;
  }

  function stageDots(p) {
    var all = [];
    MODES.forEach(function (mode) {
      var lines = state.lines[mode];
      if (!lines || !lines.length) return;
      var dep = state.deps[mode];
      var mp = CD.UI.modeParams(p, mode);
      var dots = CD.buildDots({
        lines: lines,
        depth: dep.depth,
        grad: dep.grad,
        mask: dep.mask,
        flow: mode === 'surface' ? state.flow : null,
        fieldScale: state.fieldScale,
        params: mp,
        rng: CD.makeRng(mp.seed ^ 0x9e3779b9),
        gate: gateFor(mode)
      });
      for (var i = 0; i < dots.length; i++) all.push(dots[i]);
    });
    state.dots = all;
  }

  function stageDraw() {
    var p = state.params;
    if (!ctx) return;
    state.ramp = CD.makeRamp(p.colorFar, p.colorNear);

    ctx.save();
    ctx.fillStyle = p.background;
    ctx.fillRect(0, 0, state.viewW, state.viewH);
    if (p.showImage && state.srcCanvas) {
      ctx.drawImage(state.srcCanvas, 0, 0, state.viewW, state.viewH);
    }

    /* Batch by colour bucket: one fillStyle change per bucket instead of one
     * per dot, which is the difference between a stutter and an instant
     * redraw at a hundred thousand dots. */
    var dots = state.dots;
    var buckets = 32, b, i;
    var groups = new Array(buckets);
    for (b = 0; b < buckets; b++) groups[b] = [];
    for (i = 0; i < dots.length; i++) {
      b = (dots[i].d * buckets) | 0;
      groups[b < 0 ? 0 : (b > buckets - 1 ? buckets - 1 : b)].push(dots[i]);
    }

    for (b = 0; b < buckets; b++) {
      var list = groups[b];
      if (!list.length) continue;
      var col = state.ramp((b + 0.5) / buckets, p.colorGamma);
      ctx.fillStyle = 'rgb(' + col[0] + ',' + col[1] + ',' + col[2] + ')';
      for (i = 0; i < list.length; i++) {
        var d = list[i];
        CD.drawDot(ctx, d.x, d.y, d.s, d.r, CD.shapeTypeForDot(p, d));
      }
    }
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
    q.sLineSpacing = p.sLineSpacing * 1.8;
    q.fSpacing = p.fSpacing * 1.8;
    q.sDotSpacing = p.sDotSpacing * 1.5;
    q.eDotSpacing = p.eDotSpacing * 1.5;
    q.fDotSpacing = p.fDotSpacing * 1.5;
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
    e.textContent = state.lineCount.toLocaleString() + ' contours · ' +
      state.dots.length.toLocaleString() + ' dots · ' +
      Math.round(state.timing[quality] || 0) + ' ms' +
      (quality === 'draft' ? ' (preview)' : '');
  }

  /* The photograph, as the SVG has to carry it: JPEG unless the source has
   * transparency to preserve. Only embedded when Show image is on, so the
   * download holds exactly what the canvas shows. */
  function imageDataURL() {
    if (!state.srcCanvas) return null;
    try {
      return state.srcCanvas.toDataURL('image/jpeg', 0.88);
    } catch (e) {
      return null;
    }
  }

  function currentSVG() {
    var p = state.params;
    return CD.buildSVG({
      width: state.viewW, height: state.viewH,
      background: p.background,
      image: p.showImage ? imageDataURL() : null,
      dots: state.dots,
      params: p,
      ramp: CD.makeRamp(p.colorFar, p.colorNear),
      colorGamma: p.colorGamma,
      title: state.srcName + ' — contour dots'
    });
  }

  function settingsText() {
    var rows = CD.UI.settingsList(state.params, state.shapeNames);
    var lines = rows.map(function (r) {
      return '["' + r[0] + '": "' + r[1] + '"]';
    });
    return lines.join('\n') + '\n';
  }

  /* One download: a folder holding the drawing and the settings that made
   * it. A browser cannot hand over a directory, so it hands over the archive
   * that unpacks into one. */
  function exportBundle() {
    if (!state.dots.length) { status('Nothing to export yet.', true); return; }
    if (state.pendingFull || state.quality !== 'full') {
      clearTimeout(fullTimer);
      run('full');
    }
    var base = (state.srcName || 'contour-dots').replace(/[^\w.-]+/g, '-');
    var svg = currentSVG();
    var zip = CD.makeZip([
      { name: base + '/' + base + '.svg', data: svg },
      { name: base + '/' + base + '-settings.txt', data: settingsText() }
    ]);
    CD.downloadBlob(base + '.zip', zip);
    status('Downloaded ' + base + '.zip · ' + (zip.size / 1048576).toFixed(2) + ' MB · ' +
           state.dots.length.toLocaleString() + ' vector dots');
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
      var slot = state.pendingShapeSlot || 'node';
      state.pendingShapeSlot = null;
      shapeInput.value = '';
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          CD.setPairShape(slot, CD.shapeFromSVG(fr.result, f.name));
          state.shapeNames[slot] = f.name;
          if (ui.refs.shapePair.pairLoaded) ui.refs.shapePair.pairLoaded(slot, f.name);
          status('Shape ' + (slot === 'node' ? '1' : '2') + ' set from ' + f.name);
          markDirty('draw');
        } catch (e) {
          status(e.message, true);
        }
      };
      fr.onerror = function () { status('Could not read that file.', true); };
      fr.readAsText(f);
    });

    $('#download').addEventListener('click', exportBundle);

    $('#reset').addEventListener('click', function () {
      /* Copy the defaults *into* the live object. Every control closure holds
       * a reference to it, so replacing it left them all writing to an object
       * nothing reads any more — after one Reset the whole panel went dead. */
      var def = CD.UI.defaults();
      Object.keys(def).forEach(function (k) {
        if (k !== 'seed') state.params[k] = def[k];
      });
      ui.syncAll();
      markDirty('depth');
      status('Controls reset');
    });

    /* drag & drop: images set the source, SVGs fill the node slot */
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
        state.pendingShapeSlot = 'node';
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
          state.pendingShapeSlot = slot || 'node';
          document.getElementById('shapeInput').click();
        } });

    wireChrome();
    setSource(makeSampleImage(), 'sample');
    status('Drop an image anywhere, or load one. Drop an SVG to set shape 1.');
  };

  window.windowResized = function () { /* canvas is CSS-scaled; nothing to do */ };

  CD.state = state;
})(CD);
