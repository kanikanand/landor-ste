/* ============================================================================
 * app.js — p5 sketch + pipeline orchestration.
 *
 * Pipeline, in dependency order. A control only dirties its own stage and
 * everything downstream of it, so dragging a dot slider never re-traces the
 * contours and never rebuilds the depth field.
 *
 *   depth  ->  region  ->  flow  ->  lines  ->  dots  ->  draw
 * ==========================================================================*/
var CD = window.CD || {};

(function (CD) {
  'use strict';

  var VIEW_MAX = 900;    // long side of the render canvas, in CSS px
  /* Long side of the analysis grid. Everything — the silhouette, the depth,
   * the flow field — is read at this size, so it is the ceiling on how fine a
   * detail can be detected at all. 420 was chosen when the pipeline was much
   * slower than it is now, and it was quietly throwing away the small stuff. */
  var FIELD_MAX = 640;

  var STAGES = CD.UI.STAGES;

  var state = {
    params: CD.UI.defaults(),
    srcCanvas: null,     // full-res source image on a canvas
    srcName: 'sample',
    viewW: 700, viewH: 700,
    fieldW: 0, fieldH: 0, fieldScale: 1,
    dep: null, region: null, tone: null, flow: null, lines: [], dots: [],
    hasAlpha: false,     // the source carries its own silhouette
    backCanvas: null,    // the empty-set frame, when one has been loaded
    maskFrom: 'brightness',
    matte: null,
    touched: {},         // what the user has moved; a mode never overrides it
    cutout: null,       // matte from the in-page model
    auto: null,          // what the tuner read off the plate
    modelDepth: null,    // {data,w,h,ms,backend} estimated depth for srcCanvas
    modelBusy: false,
    modelToken: 0,       // bumped on every new image, to drop stale estimates
    ramp: null,
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
  var previewCanvas = null;

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

    /* The depth estimate belongs to the old image. Bumping the token also
     * retires any request still in flight, so its result cannot land on top
     * of the new one. */
    state.modelDepth = null;
    state.modelBusy = false;
    state.cutout = null;
    state.cutoutBusy = false;
    state.modelToken++;

    if (state.params.autoTune) runAuto();

    markDirty('depth');
    if (state.params.modelDepth) ensureModelDepth();
    if (state.params.cutoutModel) ensureCutout();
  }

  /* The empty set, loaded as a second frame. Kept at the source's own size;
   * it is only ever sampled at the analysis grid. */
  function loadBackplate(file) {
    if (!file || !/^image\//.test(file.type)) {
      status('That file is not an image.', true);
      return;
    }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var c = document.createElement('canvas');
      var max = 1600;
      var sc = Math.min(1, max / Math.max(img.width, img.height));
      c.width = Math.max(1, Math.round(img.width * sc));
      c.height = Math.max(1, Math.round(img.height * sc));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      state.backCanvas = c;
      markDirty('depth');
      status('Background plate loaded — the subject is now cut out by difference.');
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      status('Could not decode that image.', true);
    };
    img.src = url;
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

    /* Concepts have nothing to read: the field IS the image. It is built
     * rather than measured, and then handed to exactly the same pipeline a
     * photograph would go through, so contours, spacing, size and colour all
     * behave identically. */
    if (p.fieldSource === 'generative') {
      var gm = new CD.Field(fw, fh, 1);
      gm.data.fill(1);
      var gf = CD.Generative.build(fw, fh, p);
      state.dep = CD.withDepth({ mask: gm, w: fw, h: fh }, gf, p);
      state.tone = gf;
      state.hasAlpha = false;
      state.maskFrom = 'generated';
      state.matte = null;
      return;
    }

    /* An estimated depth map replaces step 1 of the depth pipeline and nothing
     * else: it lands on the same analysis grid and every control below still
     * means what it meant. While an estimate is still loading this falls
     * through to luminance, so there is always something on screen. */
    /* The source is rasterised at the analysis resolution either way: the
     * luminance path needs its pixels, and both paths want its alpha, which
     * is the exact silhouette when the image carries one. */
    var c = document.createElement('canvas');
    c.width = fw; c.height = fh;
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(state.srcCanvas, 0, 0, fw, fh);
    var px = g.getImageData(0, 0, fw, fh).data;

    state.tone = CD.toneField(px, fw, fh);
    var alpha = chooseCoverage(p, px, fw, fh);

    if (p.modelDepth && state.modelDepth) {
      var md = state.modelDepth;
      state.dep = CD.buildDepthFromValues(
        CD.resampleGray(md.data, md.w, md.h, fw, fh), fw, fh, p, alpha);
    } else {
      state.dep = CD.buildDepth(px, fw, fh, p, alpha);
    }

    /* This used to sit only on the luminance branch, which meant switching AI
     * depth on silently discarded the chosen field: an edge trace or a gather
     * quietly became a plain depth map. The silhouette is what the model is
     * for; which surface the dots follow is a separate decision, and it is
     * made here either way. */
    applyFieldSource(p);
  }

  /* Which reading decides where the subject is. Brightness is the fallback
   * because it needs nothing, not because it is good: on a subject that sits
   * both above and below the ground's own level — a lit face and dark hair
   * against a mid-grey wall — no cutoff exists that separates them, and the
   * modes end up drawing the light-and-shadow line across the face instead of
   * the person's outline. The other three sources do not have that failure. */
  function chooseCoverage(p, px, fw, fh) {
    var n = fw * fh;
    var src = p.maskSource || 'auto';
    var alpha = p.useAlpha === false ? null : CD.alphaCoverage(px, n);
    state.hasAlpha = !!alpha;
    state.maskFrom = 'brightness';
    state.matte = null;

    /* A second frame of the empty set: the subject is wherever the two
     * differ. Exact, and it needs nothing but the extra exposure. */
    if ((src === 'auto' || src === 'backplate') && state.backCanvas) {
      var bg = rasterise(state.backCanvas, fw, fh);
      var m = CD.Matte.backplate(px, bg, n, p.maskTolerance, 0.04);
      var q = CD.Matte.quality(m, n);
      state.matte = q;
      if (q.usable || src === 'backplate') { state.maskFrom = 'backplate'; return m; }
    }

    /* A matting model, run in the page. The same family rembg uses on the
     * desktop, so a transparent PNG made there and this are interchangeable —
     * this route just means the Python step is optional. */
    if ((src === 'auto' || src === 'cutout') && p.cutoutModel && state.cutout) {
      var cm = state.cutout;
      var cv = CD.resampleGray(cm.data, cm.w, cm.h, fw, fh);
      var cq = CD.Matte.quality(cv, n);
      state.matte = cq;
      if (cq.usable || src === 'cutout') { state.maskFrom = 'cut-out'; return cv; }
    }

    /* The subject is the near part. Works from one frame and ignores tone. */
    if ((src === 'auto' || src === 'depth') && p.modelDepth && state.modelDepth) {
      var md = state.modelDepth;
      var d = CD.resampleGray(md.data, md.w, md.h, fw, fh);
      var dm = CD.Matte.fromDepth(d, n, p.maskDepthBias || 0);
      var dq = CD.Matte.quality(dm, n);
      state.matte = dq;
      if (dq.usable || src === 'depth') { state.maskFrom = 'depth'; return dm; }
    }

    if (alpha && (src === 'auto' || src === 'alpha')) {
      state.maskFrom = 'alpha';
      return alpha;
    }
    return null;                       // fall through to the brightness cutoff
  }

  function rasterise(canvas, fw, fh) {
    var c = document.createElement('canvas');
    c.width = fw; c.height = fh;
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(canvas, 0, 0, fw, fh);
    return g.getImageData(0, 0, fw, fh).data;
  }

  /* Fingerprint and interaction do not read the picture's tones for depth —
   * they read distance from the outline, so the contours come out as offsets
   * of the subject rather than as a halftone of whatever is behind it. The
   * silhouette is unchanged; only the surface the contours follow is. */
  function applyFieldSource(p) {
    if (!state.dep) return;

    /* Trace: height is distance from the outline, so contours are offsets of
     * the silhouette. */
    if (p.fieldSource === 'distance') {
      var d = CD.distanceDepth(state.dep.mask, state.dep.w, state.dep.h,
                               Math.max(4, (p.edgeBand || 12) * 1.6));
      state.dep = CD.withDepth(state.dep, d, p);
      return;
    }

    /* One of the twelve named formations. It owes the photograph nothing —
     * the height is built from the keyword — but it still arrives as a depth
     * field, so placement, protection and copy space all keep working and the
     * formation can be laid inside a silhouette as readily as across a frame. */
    if (p.fieldSource === 'abstract' && CD.Abstract) {
      state.dep = CD.withDepth(state.dep,
        CD.Abstract.build(state.dep.w, state.dep.h, p.abstractField, p), p);
      return;
    }

    /* Gather: height is proximity to the focal point, so density concentrates
     * there and thins away from it. Built by the same generator as Concepts,
     * with the star influence off — this is about one point, not a geometry. */
    if (p.fieldSource === 'focus') {
      var f = CD.Generative.build(state.dep.w, state.dep.h, {
        focusX: p.focusX, focusY: p.focusY, focusReach: p.focusReach,
        fieldAngle: p.fieldAngle, converge: 1, starInfluence: 0
      });
      state.dep = CD.withDepth(state.dep, f, p);
    }
  }

  /* Field 3. The silhouette the depth threshold carved, narrowed to the area
   * the wipe allows. Cheap — one multiply over the analysis grid — so it can
   * sit on its own stage and a wipe slider never rebuilds the depth field. */
  function stageRegion(p) {
    state.region = CD.buildRegion(state.dep.mask, state.dep.w, state.dep.h, p);
  }

  function stageFlow(p) {
    p = withDerived(p);
    state.flow = CD.buildFlow(state.dep, p, function (x, y) {
      return (typeof noise === 'function') ? noise(x, y) : 0.5;
    });
  }

  /* Rows are spaced off the same number as the dots along them. Two separate
   * spacings were two ways to say one thing, and they fought each other. */
  function withDerived(p) {
    var q = {};
    Object.keys(p).forEach(function (k) { q[k] = p[k]; });
    /* Row spacing follows dot spacing. Two separate numbers were two ways of
     * saying one thing, and they fought: tightening the dots left the rows
     * where they were, so the field went stripy instead of finer. Flow
     * smoothing is deliberately NOT set here — auto reads it off the grain,
     * and overriding it would undo that. */
    q.lineSpacing = Math.max(2, p.dotSpacing * 1.7);
    return q;
  }

  function stageLines(p) {
    p = withDerived(p);

    /* A chosen formation replaces the tracer outright. It emits the same
     * polylines the tracer does, so nothing downstream can tell the
     * difference: the dots are still walked along a path by arc length and
     * still read their size, spacing and colour from the depth field. What
     * changes is who decided where the paths go — the picture, or you. */
    var formed = CD.Formation.build({
      viewW: state.viewW, viewH: state.viewH,
      mask: state.region, fieldScale: state.fieldScale,
      gate: CD.gateFor(p.edgeDissolve), params: p
    });
    if (formed) { state.lines = formed; return; }

    var tracer = new CD.Tracer({
      flow: state.flow,
      depth: state.dep.depth,
      mask: state.region,
      insideMin: CD.gateFor(p.edgeDissolve),
      viewW: state.viewW, viewH: state.viewH,
      fieldScale: state.fieldScale,
      params: p,
      rng: CD.makeRng(p.seed)
    });
    state.lines = tracer.run();
  }

  function stageDots(p) {
    p = withDerived(p);
    var args = {
      lines: state.lines,
      depth: state.dep.depth,
      grad: state.dep.grad,
      relief: state.dep.relief,
      mask: state.region,
      flow: state.flow,
      tone: state.tone,
      viewW: state.viewW, viewH: state.viewH,
      fieldScale: state.fieldScale,
      params: p,
      rng: CD.makeRng(p.seed ^ 0x9e3779b9)
    };
    state.dots = CD.buildDots(args);
  }

  /* The palette may be a flat colour, a pair, or a gradient through three
   * stops. All three are the same object to everything downstream, because
   * the ramp is what everything downstream actually holds. */
  function rampFor(p) {
    if (p.colorStops && p.colorStops.length) return CD.makeRamp(p.colorStops);
    return CD.makeRamp(p.colorFar, p.colorNear);
  }

  function stageDraw() {
    var p = state.params;
    if (!ctx) return;
    state.ramp = rampFor(p);

    ctx.save();
    ctx.fillStyle = p.background;
    ctx.fillRect(0, 0, state.viewW, state.viewH);

    /* The photograph goes under the dots, and where no dot falls it is simply
     * never covered — that is the whole trick of a partial overlay. */
    if (p.showPhoto && state.srcCanvas && p.photoFade < 1) {
      ctx.save();
      ctx.globalAlpha = 1 - p.photoFade;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(state.srcCanvas, 0, 0, state.viewW, state.viewH);
      ctx.restore();

      /* Hand-over. Left alone, the photograph carries on at full strength
       * underneath the dots and the two representations fight: the picture
       * still reads as the subject, and the dots read as something laid over
       * the top of it. Taking the photograph back down across the same edge
       * the dots come up on makes it one subject drawn two ways and handed
       * from one to the other, which is what the split is for. */
      if (p.wipe && p.photoWipe > 0) drawPhotoHandover(p);
    }

    if (p.depthPreview && state.dep) drawDepthPreview();

    /* Nodes: the row drawn as a line through its own dots, so the field reads
     * as a network rather than as loose points. Drawn under the dots so every
     * join disappears behind the dot it arrives at. */
    if (p.connect > 0) {
      var cd = state.dots;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = p.colorNear;
      ctx.globalAlpha = Math.min(1, p.connect);
      ctx.lineWidth = Math.max(0.35, p.dotSize * 0.22 * p.connect);
      ctx.beginPath();
      for (var q = 1; q < cd.length; q++) {
        var a0 = cd[q - 1], b0 = cd[q];
        if (a0.li !== b0.li) continue;
        /* a jump means the row restarted somewhere else */
        if (Math.hypot(b0.x - a0.x, b0.y - a0.y) > p.dotSpacing * 3) continue;
        ctx.moveTo(a0.x, a0.y);
        ctx.lineTo(b0.x, b0.y);
      }
      ctx.stroke();
      ctx.restore();
    }

    /* Batch by colour and opacity bucket: one state change per bucket instead
     * of one per dot, which is the difference between a stutter and an instant
     * redraw at a hundred thousand dots. Opacity is quantised so that a fully
     * opaque dot lands exactly on 1 rather than on the top bucket's midpoint —
     * otherwise every render would be imperceptibly translucent. */
    var dots = state.dots;
    var CB = CD.COLOR_BUCKETS, AB = CD.ALPHA_BUCKETS;
    var groups = [], i, k;

    for (i = 0; i < dots.length; i++) {
      k = CD.bucketOf(dots[i], CB, AB);
      (groups[k] || (groups[k] = [])).push(dots[i]);
    }

    for (k = 0; k < CB * AB; k++) {
      var list = groups[k];
      if (!list) continue;
      var cb = (k / AB) | 0, ab = k % AB;
      var col = state.ramp((cb + 0.5) / CB, p.colorGamma);
      ctx.globalAlpha = AB > 1 ? ab / (AB - 1) : 1;
      ctx.fillStyle = 'rgb(' + col[0] + ',' + col[1] + ',' + col[2] + ')';
      for (i = 0; i < list.length; i++) {
        var d = list[i];
        CD.drawDot(ctx, d.x, d.y, d.s, d.r, p.shapeType);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* Knock the photograph back on the side the dots are on, using a gradient
   * built from the very same wipe geometry the region field used — so the two
   * edges coincide exactly instead of drifting apart at odd angles or aspect
   * ratios. Painting the background colour over the photograph through that
   * gradient is all it takes; no per-pixel work. */
  function drawPhotoHandover(p) {
    var g = CD.wipeGeometry(p);
    var W = state.viewW, H = state.viewH;

    /* the wipe parameter is linear in view pixels: t = A*x + B*y + C */
    var A = g.ux / (W * g.span), B = g.uy / (H * g.span);
    var C = (-0.5 * g.ux - 0.5 * g.uy - g.lo) / g.span;
    var G2 = A * A + B * B;
    if (G2 < 1e-18) return;

    var cx = W * 0.5, cy = H * 0.5;
    var tc = A * cx + B * cy + C;
    var e0 = g.e0, e1 = g.e1;
    /* a hard wipe would be a degenerate gradient; give it a hair of width */
    if (Math.abs(e1 - e0) < 1e-4) { e0 -= 5e-5; e1 += 5e-5; }

    var k0 = (e0 - tc) / G2, k1 = (e1 - tc) / G2;
    var grad = ctx.createLinearGradient(cx + A * k0, cy + B * k0,
                                        cx + A * k1, cy + B * k1);
    var rgb = CD.hexToRgb(p.background);
    var head = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',';
    grad.addColorStop(0, head + '0)');
    grad.addColorStop(1, head + CD.clamp(p.photoWipe, 0, 1) + ')');

    ctx.save();
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  /* Field 1 as a greyscale underlay, masked by the negative space, so you can
   * see what the contours are actually following — which is the only way to
   * tell an estimated depth map from a luminance one at a glance. A viewing
   * aid: the SVG export carries the dots, not this. */
  function drawDepthPreview() {
    var dep = state.dep, fw = dep.w, fh = dep.h, n = fw * fh;
    if (!previewCanvas) previewCanvas = document.createElement('canvas');
    if (previewCanvas.width !== fw || previewCanvas.height !== fh) {
      previewCanvas.width = fw; previewCanvas.height = fh;
    }
    var g = previewCanvas.getContext('2d');
    var img = g.createImageData(fw, fh);
    var out = img.data, d = dep.depth.data;
    var m = (state.region || dep.mask).data;
    for (var i = 0; i < n; i++) {
      var v = Math.round(CD.clamp(d[i], 0, 1) * CD.clamp(m[i], 0, 1) * 255);
      out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);

    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(previewCanvas, 0, 0, state.viewW, state.viewH);
    ctx.restore();
  }

  /* ==========================================================================
   * Auto-tune
   * ========================================================================*/

  /* Read the plate and set the parameters that have a right answer for it.
   * Runs once per image rather than per render — nothing here depends on a
   * slider — and writes into the same params the Advanced panel edits, so
   * what it decided is visible and can be overridden rather than hidden. */
  function runAuto() {
    if (!state.srcCanvas || !CD.Auto || !state.fieldW) return;
    var fw = state.fieldW, fh = state.fieldH;
    var c = document.createElement('canvas');
    c.width = fw; c.height = fh;
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(state.srcCanvas, 0, 0, fw, fh);
    var px = g.getImageData(0, 0, fw, fh).data;

    var alpha = state.params.useAlpha === false ? null : CD.alphaCoverage(px, fw * fh);
    var t = CD.Auto.tune(px, fw, fh, alpha);
    state.auto = t;
    CD.Auto.OWNED.forEach(function (k) {
      if (t[k] !== undefined) state.params[k] = t[k];
    });
    if (ui) ui.syncAll();
  }

  /* Switching mode changes where the dots go. It must not undo the work of
   * getting them to look right: a preset is a starting point for a control
   * nobody has touched yet, not an instruction to discard a decision someone
   * has already made. So anything the user has moved is left exactly as it
   * is, and only the untouched settings take the new mode's suggestion.
   *
   * The three that define the mode are the exception — they are the mode. */
  /* A preset names all four layers; changing a layer on its own recomposes
   * from the layers as they now stand. Either way what the user has moved is
   * left alone, because a preset is a starting point and not a reset. */
  function applyPreset() {
    CD.Art.applyPreset(state.params, state.params.preset, state.touched);
    afterDirection();
  }

  /* Changing one layer recomposes from the preset with that layer swapped,
   * NOT from the layers alone. Composing from the layers alone quietly threw
   * the preset's own settings away: moving the intensity on an abstract
   * formation restored the relief that the preset had turned off, so the rings
   * started to wobble, and moving the placement replaced the named field with
   * a plain depth map — two settings nobody touched, changed by a control that
   * had nothing to do with either.
   *
   * The behaviour is the one exception, because deciding what the dots read is
   * precisely what it is for: when it changes, the preset's field source is
   * dropped so the new behaviour can name its own. */
  function applyLayers(key) {
    var preset = CD.Art.PRESETS[state.params.preset] || {};
    var extra = {};
    Object.keys(preset.params || {}).forEach(function (k) { extra[k] = preset.params[k]; });
    if (key === 'behaviour') delete extra.fieldSource;

    CD.Art.compose(state.params, {
      content: state.params.content,
      behaviour: state.params.behaviour,
      placement: state.params.placement,
      intensity: state.params.intensity,
      lead: state.params.lead,
      params: extra
    }, state.touched);
    afterDirection();
  }

  function afterDirection() {
    CD.Art.applyPalette(state.params, state.params.palette);
    if (ui) { ui.syncAll(); ui.modeChanged(state.params); }
  }

  /* ==========================================================================
   * Depth model
   * ========================================================================*/

  /* Estimate depth for the current image, once. Cached on the image, so
   * toggling the control off and back on is free and no slider ever waits on
   * the model. Everything is reported through the status bar because the
   * first run has a model download in front of it. */
  function ensureModelDepth() {
    if (!state.srcCanvas || state.modelDepth || state.modelBusy) return;
    if (!CD.DepthModel) { failModelDepth('Depth model module is missing.'); return; }

    var reason = CD.DepthModel.unavailableReason();
    if (reason) { failModelDepth(reason); return; }

    var token = state.modelToken;
    state.modelBusy = true;
    status(CD.DepthModel.loaded()
      ? 'Estimating depth…'
      : 'Loading ' + CD.DepthModel.MODEL_ID + ' — first run downloads the model.');

    CD.DepthModel.estimate(state.srcCanvas, function (pr) {
      if (token !== state.modelToken) return;
      if (pr.phase === 'download') {
        status('Downloading depth model — ' + Math.round(pr.pct) + '% · ' + pr.backend);
      } else if (pr.phase === 'infer') {
        status('Estimating depth on ' + pr.backend + '…');
      }
    }).then(function (res) {
      if (token !== state.modelToken) return;   // the image changed under us
      state.modelBusy = false;
      state.modelDepth = res;
      status('Depth estimated · ' + res.backend + ' · ' + Math.round(res.ms) + ' ms · ' +
             res.w + '\u00d7' + res.h);
      markDirty('depth');
    }).catch(function (e) {
      if (token !== state.modelToken) return;
      state.modelBusy = false;
      console.error(e);
      failModelDepth(e.message);
    });
  }

  /* Same shape as the depth model: fetched only when asked, cached against
   * the image, and failing loudly rather than silently. */
  function ensureCutout() {
    if (!state.srcCanvas || state.cutout || state.cutoutBusy) return;
    if (!CD.DepthModel) { failCutout('Model module is missing.'); return; }
    var reason = CD.DepthModel.unavailableReason();
    if (reason) { failCutout(reason); return; }

    var token = state.modelToken;
    state.cutoutBusy = true;
    status('Loading ' + CD.DepthModel.MATTE_ID + ' to cut the subject out…');

    CD.DepthModel.cutout(state.srcCanvas, function (pr) {
      if (token !== state.modelToken) return;
      if (pr.phase === 'download') {
        status('Downloading cut-out model — ' + Math.round(pr.pct) + '% · ' + pr.backend);
      } else if (pr.phase === 'infer') {
        status('Cutting the subject out on ' + pr.backend + '…');
      }
    }).then(function (res) {
      if (token !== state.modelToken) return;
      state.cutoutBusy = false;
      state.cutout = res;
      status('Subject cut out · ' + res.backend + ' · ' + Math.round(res.ms) + ' ms');
      markDirty('depth');
    }).catch(function (e) {
      if (token !== state.modelToken) return;
      state.cutoutBusy = false;
      console.error(e);
      failCutout(e.message);
    });
  }

  function failCutout(msg) {
    state.params.cutoutModel = false;
    if (ui) ui.set('cutoutModel', false);
    status(msg, true);
    markDirty('depth');
  }

  /* Drop back to luminance, with the control switched off and the reason
   * shown. Silently rendering the fallback would read as the model working
   * badly rather than as the model not being there. */
  function failModelDepth(msg) {
    state.params.modelDepth = false;
    if (ui) ui.set('modelDepth', false);
    status(msg, true);
    markDirty('depth');
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

    /* The draft pass already produced correct depth, region and flow (it only
     * shrinks line and dot counts), so the full pass restarts at the lines. */
    if (quality === 'full' && state.quality === 'draft' &&
        STAGES.indexOf(from) < STAGES.indexOf('lines')) {
      from = 'lines';
    }

    var p = quality === 'draft' ? draftParams(state.params) : state.params;
    var i0 = STAGES.indexOf(from);
    var t0 = performance.now();

    try {
      if (i0 <= 0) stageDepth(p);
      if (i0 <= 1) stageRegion(p);
      if (i0 <= 2) stageFlow(p);
      if (i0 <= 3) stageLines(p);
      if (i0 <= 4) stageDots(p);
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
    refreshAvailability();
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

  /* What the three conditional controls actually have to work with. Called
   * after every render, because loading an image can change the answer. */
  function refreshAvailability() {
    if (!ui) return;
    var netReason = CD.DepthModel ? CD.DepthModel.unavailableReason() : 'module missing';
    ui.availability({
      alpha: !!state.hasAlpha,
      network: !netReason,
      reasons: {
        alpha: 'this image has no cut-out',
        network: netReason || ''
      }
    });
  }

  function updateStats(quality) {
    var e = $('#stats');
    if (!e) return;
    e.textContent = state.lines.length.toLocaleString() + ' contours · ' +
      state.dots.length.toLocaleString() + ' dots · ' +
      Math.round(state.timing[quality] || 0) + ' ms' +
      ' · subject from ' + state.maskFrom +
      (state.matte && !state.matte.usable ? ' (unreliable)' : '') +
      (state.params.autoTune && state.auto
        ? ' · auto: noise ' + state.auto._noise.toFixed(3) +
          ', range ' + state.auto._range.toFixed(2) +
          (state.auto.invert ? ', inverted' : '')
        : '') +
      (quality === 'draft' ? ' (preview)' : '');
  }

  /* One button, one folder: the artwork and a plain record of everything that
   * made it, so a render can be picked back up in a week without guessing
   * which settings produced it. Browsers cannot write a directory, so the
   * folder is a zip with one prefix on both entries. */
  function downloadBundle() {
    if (!state.dots.length) { status('Nothing to export yet.', true); return; }
    if (state.pendingFull || state.quality !== 'full') {
      clearTimeout(fullTimer);
      run('full');
    }
    var p = state.params;
    var svg = CD.buildSVG({
      width: state.viewW, height: state.viewH,
      background: p.background, dots: state.dots, shapeType: p.shapeType,
      ramp: state.ramp, colorGamma: p.colorGamma,
      connect: p.connect, dotSize: p.dotSize, dotSpacing: p.dotSpacing,
      strokeColor: p.colorNear,
      title: state.srcName + ' — contour dots'
    });
    var folder = 'contour-dots-' + slug(state.srcName);
    var blob = CD.zip([
      { name: folder + '/' + slug(state.srcName) + '.svg', text: svg },
      { name: folder + '/settings.txt', text: CD.UI.describe(p, state.auto) }
    ]);
    CD.downloadBlob(folder + '.zip', blob);
    status('Downloaded ' + folder + '.zip — SVG and settings.');
  }

  function slug(s) {
    return String(s || 'render').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'render';
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
      shapeInput.value = '';
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var shape = CD.shapeFromSVG(fr.result, f.name);
          CD.setCustomShape(shape);
          state.params.shapeType = 'custom';
          ui.call('shapeType', 'customLoaded', f.name);
          ui.set('shapeType', 'custom');
          markDirty('draw');
          status('Dot shape set from ' + f.name);
        } catch (e) {
          status(e.message, true);
        }
      };
      fr.onerror = function () { status('Could not read that file.', true); };
      fr.readAsText(f);
    });

    $('#download').addEventListener('click', downloadBundle);

    var backInput = $('#backplateInput');
    $('#loadBackplate').addEventListener('click', function () { backInput.click(); });
    backInput.addEventListener('change', function () {
      if (backInput.files && backInput.files[0]) loadBackplate(backInput.files[0]);
      backInput.value = '';
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
      function (stage, key) {
        /* remember that this one is the user's now */
        if (key && key !== 'mode') state.touched[key] = true;
        /* Switching the model on is the one control that has to fetch
         * something before its stage can be rebuilt. */
        if (key === 'modelDepth' && state.params.modelDepth) ensureModelDepth();
        if (key === 'cutoutModel' && state.params.cutoutModel) ensureCutout();
        if (key === 'maskSource' && state.params.maskSource === 'cutout') {
          state.params.cutoutModel = true;
          ui.set('cutoutModel', true);
          ensureCutout();
        }
        if (key === 'preset') applyPreset();
        if (key === 'behaviour' || key === 'placement' ||
            key === 'intensity' || key === 'lead') applyLayers(key);
        if (key === 'palette') CD.Art.applyPalette(state.params, state.params.palette);
        /* which controls can do anything depends on the formation as well as
         * the placement, so both have to re-ask */
        if (key === 'formation') ui.modeChanged(state.params);
        if (key === 'autoTune' && state.params.autoTune) runAuto();
        markDirty(stage);
      },
      { pickShape: function () { document.getElementById('shapeInput').click(); } });

    wireChrome();
    applyPreset();
    setSource(makeSampleImage(), 'sample');
    status('Drop an image anywhere, or load one. Drop an SVG to set the dot shape.');
  };

  window.windowResized = function () { /* canvas is CSS-scaled; nothing to do */ };

  CD.state = state;
})(CD);
