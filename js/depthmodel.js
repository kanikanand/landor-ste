/* ============================================================================
 * depthmodel.js — monocular depth estimation, in the browser.
 *
 * The rest of the pipeline reads luminance as depth, which is only ever a
 * proxy: where a photograph's tones disagree with its geometry — a dark iris
 * on a lit face, a specular highlight sitting in a crease — the contours
 * follow the tones and the form goes wrong. This module replaces that guess
 * with an actual estimate.
 *
 * Depth Anything V2 (small) runs through transformers.js on WebGPU where it
 * is available and WebAssembly otherwise. It outputs *inverse* depth, so
 * larger already means nearer, which is the convention the field pipeline
 * wants: 1 near, 0 far. The float tensor is used rather than the 8-bit
 * preview image, because the flow field differentiates this map and 8-bit
 * quantisation shows up as banding in the gradient.
 *
 * Everything here is lazy. Nothing is fetched until the control is switched
 * on, and the result is cached per image so the sliders stay instant.
 * ==========================================================================*/
var CD = window.CD || {};

(function (CD) {
  'use strict';

  /* Pinned, and overridable before this script runs if you would rather
   * self-host the library than reach for a CDN. */
  var LIB_URL = window.CD_TRANSFORMERS_URL ||
    'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';
  var MODEL_ID = window.CD_DEPTH_MODEL || 'onnx-community/depth-anything-v2-small';

  /* Long side of the image handed to the model. The processor resizes to its
   * own input size anyway, and the analysis grid downstream is 420 px, so
   * anything larger only costs memory in the interpolate-back step. */
  var INFER_MAX = 672;

  var libPromise = null;
  var estimatorPromise = null;
  var backend = null;      // { device, dtype } once one has loaded

  /* --------------------------------------------------------------------------
   * Environment
   * ------------------------------------------------------------------------*/

  /* Why this cannot run here, or null if it can. Checked before anything is
   * fetched, so the failure is a sentence rather than a console trace. */
  function unavailableReason() {
    if (location.protocol === 'file:') {
      return 'Depth model needs the page served over http — run ' +
             '`npx http-server -p 8080 .` and reload.';
    }
    if (typeof WebAssembly === 'undefined') {
      return 'This browser has no WebAssembly, so the depth model cannot run.';
    }
    return null;
  }

  function hasWebGPU() {
    return typeof navigator !== 'undefined' && !!navigator.gpu;
  }

  /* Ordered by preference. fp32 on WebGPU is both the fastest and the
   * cleanest; on WebAssembly the quantised weights are a ~4x smaller download
   * and several times quicker, at some cost in fine detail, so full precision
   * sits behind it as the fallback rather than the default. */
  function backendCandidates() {
    var list = [];
    if (hasWebGPU()) list.push({ device: 'webgpu', dtype: 'fp32' });
    list.push({ device: 'wasm', dtype: 'q8' });
    list.push({ device: 'wasm', dtype: 'fp32' });
    return list;
  }

  function describeBackend(b) {
    if (!b) return 'not loaded';
    return b.device === 'webgpu' ? 'WebGPU' : 'WebAssembly (' + b.dtype + ')';
  }

  /* --------------------------------------------------------------------------
   * Library + model
   * ------------------------------------------------------------------------*/

  function loadLib() {
    if (libPromise) return libPromise;
    libPromise = import(/* webpackIgnore: true */ LIB_URL).then(function (mod) {
      /* Skip the local-model probe: there is no ./models/ directory here and
       * the 404 is just noise in the console. */
      mod.env.allowLocalModels = false;
      return mod;
    }).catch(function (e) {
      libPromise = null;
      throw new Error('Could not load transformers.js from ' + LIB_URL +
                      ' (' + e.message + ')');
    });
    return libPromise;
  }

  /* Build the depth-estimation pipeline, walking the backend list until one
   * loads. A device or a dtype the browser or the model repo does not carry
   * fails at construction, which is exactly where we want to find out. */
  function getEstimator(onProgress) {
    if (estimatorPromise) return estimatorPromise;

    estimatorPromise = loadLib().then(function (mod) {
      var tried = backendCandidates();

      function attempt(i) {
        if (i >= tried.length) {
          throw new Error('No usable backend for ' + MODEL_ID);
        }
        var cfg = tried[i];
        return mod.pipeline('depth-estimation', MODEL_ID, {
          device: cfg.device,
          dtype: cfg.dtype,
          progress_callback: function (info) { report(info, cfg, onProgress); }
        }).then(function (est) {
          backend = cfg;
          return est;
        }).catch(function (e) {
          console.warn('depth model: ' + cfg.device + '/' + cfg.dtype +
                       ' unavailable —', e.message);
          return attempt(i + 1);
        });
      }

      return attempt(0);
    }).catch(function (e) {
      estimatorPromise = null;   // let the next attempt start clean
      throw e;
    });

    return estimatorPromise;
  }

  /* transformers.js emits an aggregate `progress_total` across all the files
   * of a model, plus per-file events. Prefer the aggregate; fall back to the
   * per-file one so there is still movement if the aggregate is absent. */
  function report(info, cfg, onProgress) {
    if (!onProgress) return;
    if (info.status === 'progress_total') {
      onProgress({ phase: 'download', pct: info.progress || 0,
                   backend: describeBackend(cfg) });
    } else if (info.status === 'progress' && typeof info.progress === 'number') {
      onProgress({ phase: 'download', pct: info.progress, file: info.file,
                   backend: describeBackend(cfg) });
    } else if (info.status === 'ready') {
      onProgress({ phase: 'ready', pct: 100, backend: describeBackend(cfg) });
    }
  }

  /* --------------------------------------------------------------------------
   * Inference
   * ------------------------------------------------------------------------*/

  /* A copy of the source scaled so its long side is INFER_MAX. */
  function inputCanvas(src) {
    var sc = Math.min(1, INFER_MAX / Math.max(src.width, src.height));
    if (sc === 1) return src;
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(src.width * sc));
    c.height = Math.max(1, Math.round(src.height * sc));
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  /* Raw model output -> a 0..1 grid, 1 near. The model's scale is arbitrary
   * (it is relative inverse depth, not metres), so the map is min-max
   * normalised. A flat result — a blank or single-colour input — is handed
   * back as a mid-grey rather than as a divide by zero. */
  function normalise(data, n) {
    var out = new Float32Array(n);
    var lo = Infinity, hi = -Infinity, i, v;
    for (i = 0; i < n; i++) {
      v = data[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    var span = hi - lo;
    if (!(span > 1e-9)) {
      out.fill(0.5);
      return out;
    }
    for (i = 0; i < n; i++) out[i] = (data[i] - lo) / span;
    return out;
  }

  /* Estimate depth for a source canvas.
   * Resolves { data: Float32Array (0..1, 1 = near), w, h, ms, backend }. */
  function estimate(srcCanvas, onProgress) {
    var reason = unavailableReason();
    if (reason) return Promise.reject(new Error(reason));

    return getEstimator(onProgress).then(function (est) {
      if (onProgress) {
        onProgress({ phase: 'infer', pct: 100, backend: describeBackend(backend) });
      }
      var t0 = performance.now();
      return est(inputCanvas(srcCanvas)).then(function (out) {
        var w, h, vals;

        if (out.predicted_depth && out.predicted_depth.dims) {
          /* dims are [h, w]; the float tensor keeps the gradient smooth */
          var dims = out.predicted_depth.dims;
          h = dims[dims.length - 2];
          w = dims[dims.length - 1];
          vals = normalise(out.predicted_depth.data, w * h);
        } else if (out.depth) {
          /* 8-bit fallback, already min-max normalised by the pipeline */
          w = out.depth.width; h = out.depth.height;
          var src = out.depth.data, ch = out.depth.channels || 1, n = w * h;
          vals = new Float32Array(n);
          for (var i = 0; i < n; i++) vals[i] = src[i * ch] / 255;
        } else {
          throw new Error('Depth model returned nothing usable.');
        }

        return {
          data: vals, w: w, h: h,
          ms: performance.now() - t0,
          backend: describeBackend(backend)
        };
      });
    });
  }

  /* Drop the loaded model. The library stays imported — it is the model
   * weights that are worth several tens of megabytes, not the code. */
  function unload() {
    estimatorPromise = null;
    backend = null;
  }

  CD.DepthModel = {
    MODEL_ID: MODEL_ID,
    estimate: estimate,
    unload: unload,
    unavailableReason: unavailableReason,
    loaded: function () { return !!backend; },
    backend: function () { return describeBackend(backend); }
  };
})(CD);
