/* ============================================================================
 * ui.js — declarative control panel.
 *
 * Three modes, each with its own reading of the picture. A mode owns the
 * controls that decide what its marks are made of — its own threshold and
 * contrast, its own dot size and node scale — because the three want
 * different things from the same photograph: the surface wants a soft field,
 * the edge wants a hard silhouette, the fingerprint wants only the ground the
 * subject is standing against. Everything the three share (the node/link
 * shapes, the colours, whether the photograph shows through) sits once at the
 * top, and each mode's own group appears only while that mode is on, so the
 * panel stays the height of the window.
 *
 * Every control declares which pipeline stage it dirties, so moving a dot
 * slider does not rebuild the depth field or re-trace the streamlines. The
 * stages cascade: depth -> flow -> lines -> dots -> draw.
 * ==========================================================================*/
var CD = window.CD || {};

(function (CD) {
  'use strict';

  var STAGES = ['depth', 'flow', 'lines', 'dots', 'draw'];

  var MODES = ['surface', 'edge', 'fingerprint'];

  /* Which toggle switches each mode on. */
  var MODE_ON = {
    surface: 'surfaceOn',
    edge: 'edgeOn',
    fingerprint: 'fingerprintOn'
  };

  /* A mode's own controls, named as the pipeline expects to read them. Every
   * stage downstream still sees a plain params object with generic keys —
   * `threshold`, `dotSize` — so nothing below this file has to know that
   * three sets of them exist. */
  var MODE_KEYS = {
    surface: {
      threshold: 'sThreshold', imageContrast: 'sContrast',
      depthSmoothing: 'sSmoothing', depthExaggeration: 'sDepth',
      lineSpacing: 'sLineSpacing',
      dotSize: 'sDotSize', dotSpacing: 'sDotSpacing', nodeScale: 'sNodeScale'
    },
    edge: {
      threshold: 'eThreshold', imageContrast: 'eContrast',
      edgeTolerance: 'eTolerance',
      dotSize: 'eDotSize', dotSpacing: 'eDotSpacing', nodeScale: 'eNodeScale'
    },
    fingerprint: {
      threshold: 'fThreshold', imageContrast: 'fContrast',
      edgeTolerance: 'fTolerance', ridgeSpacing: 'fSpacing', swirl: 'fSwirl',
      dotSize: 'fDotSize', dotSpacing: 'fDotSpacing', nodeScale: 'fNodeScale'
    }
  };

  var SCHEMA = [
    {
      group: 'Picture',
      controls: [
        { key: 'showImage', label: 'Show image', type: 'toggle', def: true, stage: 'draw' },
        { key: 'background', label: 'Background', type: 'color', def: '#000000', stage: 'draw' },
        { key: 'colorFar', label: 'Far', type: 'color', def: '#4a0410', stage: 'draw' },
        { key: 'colorNear', label: 'Near', type: 'color', def: '#ff2233', stage: 'draw' }
      ]
    },
    {
      group: 'Modes', cols: 3,
      controls: [
        { key: 'surfaceOn', label: 'Surface', type: 'toggle', def: true, stage: 'depth',
          help: 'Depth contours wrapping the form.' },
        { key: 'edgeOn', label: 'Edge', type: 'toggle', def: false, stage: 'depth',
          help: 'One line around the subject.' },
        { key: 'fingerprintOn', label: 'Fingerprint', type: 'toggle', def: false, stage: 'depth',
          help: 'Ridges in the background.' }
      ]
    },
    {
      group: 'Node + link',
      controls: [
        { key: 'shapePair', type: 'pair', stage: 'draw' },
        { key: 'nodeEvery', label: 'Node every', min: 1, max: 40, step: 1, def: 8, stage: 'dots',
          help: 'Steps between shape 1. Everything between is shape 2.' }
      ]
    },
    {
      group: 'Surface', mode: 'surface',
      controls: [
        { key: 'sThreshold', label: 'Threshold', min: 0, max: 0.95, step: 0.01, def: 0.13, stage: 'depth' },
        { key: 'sContrast', label: 'Contrast', min: 0.2, max: 4, step: 0.05, def: 1.35, stage: 'depth' },
        { key: 'sDepth', label: 'Depth', min: 0, max: 30, step: 0.1, def: 6, stage: 'dots',
          help: 'Displaces each dot along the depth gradient. This is the relief.' },
        { key: 'sSmoothing', label: 'Smoothing', min: 0, max: 30, step: 1, def: 10, stage: 'depth',
          help: 'Turns a noisy photo into a continuous surface. Contours need this.' },
        { key: 'sLineSpacing', label: 'Line spacing', min: 2, max: 60, step: 0.5, def: 9, stage: 'lines' },
        { key: 'sDotSize', label: 'Dot size', min: 0.3, max: 14, step: 0.1, def: 2.2, stage: 'dots' },
        { key: 'sDotSpacing', label: 'Dot spacing', min: 1.5, max: 40, step: 0.25, def: 5, stage: 'dots' },
        { key: 'sNodeScale', label: 'Node scale', min: 1, max: 8, step: 0.1, def: 2.2, stage: 'dots' }
      ]
    },
    {
      group: 'Edge', mode: 'edge',
      controls: [
        { key: 'eThreshold', label: 'Threshold', min: 0, max: 0.95, step: 0.01, def: 0.13, stage: 'depth' },
        { key: 'eContrast', label: 'Contrast', min: 0.2, max: 4, step: 0.05, def: 1.35, stage: 'depth' },
        { key: 'eTolerance', label: 'Separation', min: 0.02, max: 0.6, step: 0.01, def: 0.12, stage: 'lines',
          help: 'How far the background may drift from the frame\'s own tone before the subject starts.' },
        { key: 'eDotSize', label: 'Dot size', min: 0.3, max: 14, step: 0.1, def: 3.2, stage: 'dots' },
        { key: 'eDotSpacing', label: 'Dot spacing', min: 1.5, max: 40, step: 0.25, def: 10, stage: 'dots' },
        { key: 'eNodeScale', label: 'Node scale', min: 1, max: 8, step: 0.1, def: 3, stage: 'dots' }
      ]
    },
    {
      group: 'Fingerprint', mode: 'fingerprint',
      controls: [
        { key: 'fThreshold', label: 'Threshold', min: 0, max: 0.95, step: 0.01, def: 0.13, stage: 'depth' },
        { key: 'fContrast', label: 'Contrast', min: 0.2, max: 4, step: 0.05, def: 1.35, stage: 'depth' },
        { key: 'fTolerance', label: 'Separation', min: 0.02, max: 0.6, step: 0.01, def: 0.12, stage: 'lines',
          help: 'Where the ridges stop: the flood that finds the ground the subject stands against.' },
        { key: 'fSpacing', label: 'Ridge spacing', min: 4, max: 60, step: 0.5, def: 16, stage: 'lines' },
        { key: 'fSwirl', label: 'Swirl', min: 0, max: 1, step: 0.01, def: 0.55, stage: 'lines',
          help: 'How far the ridges wander from clean offsets of the silhouette.' },
        { key: 'fDotSize', label: 'Dot size', min: 0.3, max: 14, step: 0.1, def: 1.8, stage: 'dots' },
        { key: 'fDotSpacing', label: 'Dot spacing', min: 1.5, max: 40, step: 0.25, def: 6, stage: 'dots' },
        { key: 'fNodeScale', label: 'Node scale', min: 1, max: 8, step: 0.1, def: 2, stage: 'dots' }
      ]
    }
  ];

  /* Held constant rather than exposed. The first block is what the surface
   * renderer has always used — the values v1 shipped with — so surface mode
   * still renders exactly what it rendered, with fewer knobs in front of it.
   * The second block is the same set standing in for the two modes that do
   * not read depth at all, plus the safety limits and the seed. */
  var FIXED = {
    invert: false,
    depthContrast: 1.6,
    /* only the surface renderer displaces along the depth gradient */
    depthExaggeration: 0,
    lineDensity: 1,
    flowStrength: 0.88,
    flowDistortion: 0.06,
    flowAngle: 0,
    flowSmoothing: 6,
    sizeVariation: 0.18,
    sizeFalloff: 1.35,
    randomness: 0.12,
    colorGamma: 1,

    /* the edge draws one contour: the silhouette itself */
    lineCount: 1,
    isolateSubject: true,
    /* both non-surface modes read a depth field they never shape */
    depthSmoothing: 10,

    shapeType: 'nodes',
    maxLines: 5000,
    maxPoints: 900000,
    maxDots: 160000,
    minLinePoints: 6,
    maxLineLength: 4000,
    flowNoiseScale: 1,
    seed: 12345
  };

  function defaults() {
    var p = {};
    Object.keys(FIXED).forEach(function (k) { p[k] = FIXED[k]; });
    SCHEMA.forEach(function (g) {
      g.controls.forEach(function (c) { if (c.def !== undefined) p[c.key] = c.def; });
    });
    return p;
  }

  /* One mode's view of the parameters, flattened to the generic names every
   * stage below already reads. */
  function modeParams(p, mode) {
    var q = {};
    Object.keys(FIXED).forEach(function (k) { q[k] = FIXED[k]; });
    q.seed = p.seed;
    q.nodeEvery = p.nodeEvery;
    q.background = p.background;
    q.colorFar = p.colorFar;
    q.colorNear = p.colorNear;
    q.showImage = p.showImage;
    q.mode = mode;
    var map = MODE_KEYS[mode];
    Object.keys(map).forEach(function (k) { q[k] = p[map[k]]; });
    return q;
  }

  function activeModes(p) {
    return MODES.filter(function (m) { return !!p[MODE_ON[m]]; });
  }

  /* Returns the earliest (most upstream) of two stages. */
  function earliest(a, b) {
    if (!a) return b;
    if (!b) return a;
    return STAGES.indexOf(a) < STAGES.indexOf(b) ? a : b;
  }

  /* Every setting the user can currently see, as the settings file records
   * them: the shared block, then each mode that is switched on. */
  function settingsList(p, shapeNames) {
    var out = [];
    SCHEMA.forEach(function (g) {
      if (g.mode && !p[MODE_ON[g.mode]]) return;
      g.controls.forEach(function (c) {
        if (c.type === 'pair') {
          out.push(['Node + link / Shape 1', shapeNames.node || 'circle (default)']);
          out.push(['Node + link / Shape 2', shapeNames.link || 'circle (default)']);
          return;
        }
        if (c.def === undefined) return;
        var v = p[c.key];
        if (typeof v === 'boolean') v = v ? 'on' : 'off';
        else if (typeof v === 'number') v = fmt(v, c.step);
        out.push([g.group + ' / ' + c.label, String(v)]);
      });
    });
    return out;
  }

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }

  /* Build the panel. onChange(stage) fires on every edit. */
  function buildPanel(root, params, onChange, hooks) {
    root.innerHTML = '';
    var refs = {};
    var sections = [];

    SCHEMA.forEach(function (g) {
      var sec = el('section', 'group');
      sec.dataset.mode = g.mode || '';
      sec.appendChild(el('h2', null, g.group));
      var body = el('div', 'group-body');
      if (g.cols) body.style.gridTemplateColumns = 'repeat(' + g.cols + ', 1fr)';
      sec.appendChild(body);

      g.controls.forEach(function (c) {
        var row = el('div', 'ctrl');
        if (c.help) row.title = c.help;

        if (c.type === 'toggle') {
          row.classList.add('ctrl-half');
          var lab = el('label', 'ctrl-toggle');
          var cb = el('input');
          cb.type = 'checkbox';
          cb.checked = !!params[c.key];
          cb.addEventListener('change', function () {
            params[c.key] = cb.checked;
            onChange(c.stage);
          });
          lab.appendChild(cb);
          lab.appendChild(el('span', null, c.label));
          row.appendChild(lab);
          refs[c.key] = { set: function (v) { cb.checked = !!v; } };

        } else if (c.type === 'color') {
          row.classList.add('ctrl-half');
          var top = el('div', 'ctrl-top');
          top.appendChild(el('label', null, c.label));
          var ci = el('input', 'color');
          ci.type = 'color';
          ci.value = params[c.key];
          ci.addEventListener('input', function () {
            params[c.key] = ci.value;
            onChange(c.stage);
          });
          top.appendChild(ci);
          row.appendChild(top);
          refs[c.key] = { set: function (v) { ci.value = v; } };

        } else if (c.type === 'pair') {
          /* The one shape control, shared by all three modes: shape 1 lands
           * every Nth step along a line, shape 2 fills the run between. Either
           * falls back to a plain circle until an SVG is loaded into it. */
          row.classList.add('ctrl-wide', 'ctrl-pair');
          var pairNames = {};
          CD.PAIR_SLOTS.forEach(function (slot, idx) {
            var prow = el('div', 'upload-row');
            var pbtn = el('button', 'mini pair-slot', 'Shape ' + (idx + 1));
            pbtn.title = slot === 'node' ? 'the marked points' : 'the run between them';
            pbtn.addEventListener('click', function () { hooks.pickShape(slot); });
            prow.appendChild(pbtn);
            var pname = el('span', 'file-name', 'circle');
            prow.appendChild(pname);
            pairNames[slot] = pname;
            row.appendChild(prow);
          });
          refs[c.key] = {
            set: function () {},
            pairLoaded: function (slot, name) {
              if (pairNames[slot]) pairNames[slot].textContent = name;
            }
          };

        } else {
          var t2 = el('div', 'ctrl-top');
          t2.appendChild(el('label', null, c.label));
          var val = el('span', 'val', fmt(params[c.key], c.step));
          t2.appendChild(val);
          row.appendChild(t2);

          var sl = el('input', 'slider');
          sl.type = 'range';
          sl.min = c.min; sl.max = c.max; sl.step = c.step;
          sl.value = params[c.key];
          sl.addEventListener('input', function () {
            params[c.key] = parseFloat(sl.value);
            val.textContent = fmt(params[c.key], c.step);
            onChange(c.stage);
          });
          row.appendChild(sl);
          refs[c.key] = {
            set: function (v) { sl.value = v; val.textContent = fmt(v, c.step); }
          };
        }

        body.appendChild(row);
      });

      sections.push(sec);
      root.appendChild(sec);
    });

    /* A mode's group is only in the way while that mode is off. */
    function syncVisibility() {
      sections.forEach(function (sec) {
        var m = sec.dataset.mode;
        sec.hidden = !!m && !params[MODE_ON[m]];
      });
    }
    syncVisibility();

    return {
      refs: refs,
      syncVisibility: syncVisibility,
      syncAll: function () {
        SCHEMA.forEach(function (g) {
          g.controls.forEach(function (c) {
            if (refs[c.key] && refs[c.key].set) refs[c.key].set(params[c.key]);
          });
        });
        syncVisibility();
      }
    };
  }

  function fmt(v, step) {
    if (typeof v !== 'number') return String(v);
    var dp = (step && step < 1) ? (String(step).split('.')[1] || '').length : 0;
    return v.toFixed(Math.min(dp, 2));
  }

  CD.UI = {
    SCHEMA: SCHEMA, STAGES: STAGES, FIXED: FIXED, MODES: MODES, MODE_ON: MODE_ON,
    defaults: defaults, buildPanel: buildPanel, earliest: earliest,
    modeParams: modeParams, activeModes: activeModes, settingsList: settingsList
  };
})(CD);
