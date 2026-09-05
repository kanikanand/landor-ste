/* ============================================================================
 * ui.js — declarative control panel.
 *
 * Every control declares which pipeline stage it dirties, so moving a dot
 * slider does not rebuild the depth field or re-trace the streamlines. The
 * stages cascade: depth -> flow -> lines -> dots -> draw.
 * ==========================================================================*/
var CD = window.CD || {};

(function (CD) {
  'use strict';

  var STAGES = ['depth', 'flow', 'lines', 'dots', 'draw'];

  var SCHEMA = [
    {
      group: 'Render', hint: 'Two independent layers. Either, or both at once.',
      controls: [
        { key: 'surfaceLayer', label: 'Surface contours', type: 'toggle', def: true, stage: 'flow',
          help: 'Streamlines of the flow field, wrapping the form.' },
        { key: 'edgeLayer', label: 'Edge contours', type: 'toggle', def: false, stage: 'lines',
          help: 'Offset contours of the silhouette, banding into the darks.' }
      ]
    },
    {
      group: 'Image', hint: 'The photograph, before it becomes a surface.',
      controls: [
        { key: 'threshold', label: 'Threshold', min: 0, max: 0.95, step: 0.01, def: 0.13, stage: 'depth',
          help: 'Everything below this is negative space — pure background, no dots.' },
        { key: 'imageContrast', label: 'Contrast', min: 0.2, max: 4, step: 0.05, def: 1.35, stage: 'depth' },
        { key: 'invert', label: 'Invert depth', type: 'toggle', def: false, stage: 'depth',
          help: 'Use when the subject is lit dark-on-light.' }
      ]
    },
    {
      group: 'Depth', hint: 'Field 1. Black is far, white is near.',
      controls: [
        { key: 'depthExaggeration', label: 'Depth exaggeration', min: 0, max: 30, step: 0.1, def: 6, stage: 'dots',
          help: 'Displaces each dot along the depth gradient. This is the relief.' },
        { key: 'depthContrast', label: 'Depth contrast', min: 0.2, max: 4, step: 0.05, def: 1.6, stage: 'depth',
          help: 'Steepens near against far.' },
        { key: 'depthSmoothing', label: 'Depth smoothing', min: 0, max: 30, step: 1, def: 10, stage: 'depth',
          help: 'Turns a noisy photo into a continuous surface. Contours need this.' }
      ]
    },
    {
      group: 'Contours', hint: 'Field 2. Flow runs along the iso-depth lines.',
      controls: [
        { key: 'lineDensity', label: 'Line density', min: 0.2, max: 4, step: 0.05, def: 1, stage: 'lines', modes: ['surface'] },
        { key: 'lineSpacing', label: 'Line spacing', min: 2, max: 60, step: 0.5, def: 9, stage: 'lines', modes: ['surface'] },
        { key: 'flowStrength', label: 'Flow strength', min: 0, max: 1, step: 0.01, def: 0.88, stage: 'flow', modes: ['surface'],
          help: '0 = straight lines at the base angle, 1 = pure depth contours.' },
        { key: 'flowDistortion', label: 'Flow distortion', min: 0, max: 1, step: 0.01, def: 0.06, stage: 'flow', modes: ['surface'] },
        { key: 'flowAngle', label: 'Base angle', min: 0, max: 180, step: 1, def: 0, stage: 'flow', modes: ['surface'],
          help: 'Direction the lines fall back to where the surface is flat.' },
        { key: 'flowSmoothing', label: 'Flow coherence', min: 0, max: 24, step: 1, def: 6, stage: 'flow', modes: ['surface'],
          help: 'Diffuses direction into flat regions so lines stay continuous.' }
      ]
    },
    {
      group: 'Edge', hint: 'The line where the subject leaves the background.',
      controls: [
        { key: 'edgeSource', label: 'Separation', type: 'segment', def: 'subject', stage: 'lines',
          modes: ['edge'],
          options: [{ key: 'subject', label: 'Subject' }, { key: 'threshold', label: 'Threshold' }],
          help: 'Subject floods the background in from the frame and keeps everything it cannot reach, so dark hair and a dark shirt stay part of the figure. Threshold is the plain luminance cut.' },
        { key: 'edgeTolerance', label: 'Separation tolerance', min: 0.02, max: 0.6, step: 0.01, def: 0.12, stage: 'lines',
          modes: ['edge'],
          help: 'How far that flood may stray from the frame\'s own tone before it stops.' },
        { key: 'isolateSubject', label: 'Isolate subject', type: 'toggle', def: true, stage: 'lines',
          modes: ['edge'],
          help: 'Drops stray specks and fills enclosed holes, while keeping every substantial part of the figure — separation can cut a head off its shoulders, and both are still the subject. Affects the silhouette only; the surface renderer keeps the mask exactly as it was.' },
        { key: 'lineCount', label: 'Number of lines', min: 1, max: 14, step: 1, def: 7, stage: 'lines',
          modes: ['edge'],
          help: 'Contours stepping away from the edge. The first is the silhouette itself.' },
        { key: 'edgeSpacing', label: 'Contour spacing', min: 2, max: 60, step: 0.5, def: 11, stage: 'lines',
          modes: ['edge'],
          help: 'Distance between those contours, in pixels.' },
        { key: 'lineSpread', label: 'Spread', type: 'segment', def: 'inside', stage: 'lines',
          modes: ['edge'],
          options: [{ key: 'both', label: 'Both' }, { key: 'inside', label: 'Inside' },
                    { key: 'outside', label: 'Outside' }],
          help: 'Which side of the edge the extra contours step towards.' },
        { key: 'shading', label: 'Shading', min: 0, max: 1, step: 0.01, def: 0.7, stage: 'dots',
          modes: ['edge'],
          help: 'How much tonality thins the stack: an outline alone through the lights, the full stack in the darks. At 0 every contour is drawn everywhere.' },
        { key: 'shadingFalloff', label: 'Shading falloff', min: 0.2, max: 4, step: 0.05, def: 1, stage: 'dots',
          modes: ['edge'],
          help: 'Higher confines the shading to the deepest darks.' },
        { key: 'edgeDotSize', label: 'Edge dot size', min: 0.3, max: 14, step: 0.1, def: 2.6, stage: 'dots',
          modes: ['edge'],
          help: 'Edge marks are one size along the whole contour — they describe the outline, not the surface — so they have their own size and spacing rather than depth\'s.' },
        { key: 'edgeDotSpacing', label: 'Edge dot spacing', min: 1.5, max: 40, step: 0.25, def: 9, stage: 'dots',
          modes: ['edge'] }
      ]
    },
    {
      group: 'Dots', hint: 'Oriented primitives, not particles.',
      controls: [
        { key: 'shapeType', label: 'Shape', type: 'shape', def: 'circle', stage: 'draw' },
        { key: 'nodeEvery', label: 'Node every', min: 1, max: 40, step: 1, def: 8, stage: 'dots',
          help: 'Steps between shape 1. Everything between is shape 2. Node + link only.' },
        { key: 'nodeScale', label: 'Node scale', min: 1, max: 8, step: 0.1, def: 2.2, stage: 'dots',
          help: 'How much bigger shape 1 is than shape 2.' },
        { key: 'dotSize', label: 'Dot size', min: 0.3, max: 14, step: 0.1, def: 2.2, stage: 'dots' },
        { key: 'sizeVariation', label: 'Size variation', min: 0, max: 1, step: 0.01, def: 0.18, stage: 'dots' },
        { key: 'sizeFalloff', label: 'Size falloff', min: 0.3, max: 3.5, step: 0.05, def: 1.35, stage: 'dots',
          help: 'How fast dots shrink as the surface recedes.' },
        { key: 'dotSpacing', label: 'Dot spacing', min: 1.5, max: 40, step: 0.25, def: 5, stage: 'dots' },
        { key: 'randomness', label: 'Randomness', min: 0, max: 1, step: 0.01, def: 0.12, stage: 'dots' }
      ]
    },
    {
      group: 'Colour', hint: 'Negative space stays black.',
      controls: [
        { key: 'background', label: 'Background', type: 'color', def: '#000000', stage: 'draw' },
        { key: 'colorFar', label: 'Far colour', type: 'color', def: '#4a0410', stage: 'draw' },
        { key: 'colorNear', label: 'Near colour', type: 'color', def: '#ff2233', stage: 'draw' },
        { key: 'colorGamma', label: 'Colour falloff', min: 0.3, max: 3, step: 0.05, def: 1, stage: 'draw' }
      ]
    }
  ];

  /* Values not exposed as sliders: safety limits and the random seed. */
  var FIXED = {

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
      g.controls.forEach(function (c) { p[c.key] = c.def; });
    });
    return p;
  }

  /* Returns the earliest (most upstream) of two stages. */
  function earliest(a, b) {
    if (!a) return b;
    if (!b) return a;
    return STAGES.indexOf(a) < STAGES.indexOf(b) ? a : b;
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
      var head = el('div', 'group-head');
      head.appendChild(el('h2', null, g.group));
      if (g.hint) head.appendChild(el('p', 'hint', g.hint));
      sec.appendChild(head);

      g.controls.forEach(function (c) {
        var row = el('div', 'ctrl');

        if (c.type === 'toggle') {
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

        } else if (c.type === 'segment') {
          var opts = c.options;
          row.appendChild(el('label', null, c.label));
          var seg = el('div', 'shape-row');
          opts.forEach(function (o) {
            var b = el('button', 'shape-btn', o.label);
            b.dataset.opt = o.key;
            b.addEventListener('click', function () {
              params[c.key] = o.key;
              seg.querySelectorAll('.shape-btn').forEach(function (x) {
                x.classList.toggle('on', x.dataset.opt === o.key);
              });
              onChange(c.stage);
            });
            if (params[c.key] === o.key) b.classList.add('on');
            seg.appendChild(b);
          });
          row.appendChild(seg);
          refs[c.key] = {
            set: function (v) {
              seg.querySelectorAll('.shape-btn').forEach(function (x) {
                x.classList.toggle('on', x.dataset.opt === v);
              });
            }
          };

        } else if (c.type === 'shape') {
          row.appendChild(el('label', null, c.label));
          var wrap = el('div', 'shape-row');
          var mk = function (name, text) {
            var b = el('button', 'shape-btn', text);
            b.dataset.shape = name;
            b.addEventListener('click', function () {
              params[c.key] = name;
              wrap.querySelectorAll('.shape-btn').forEach(function (o) {
                o.classList.toggle('on', o.dataset.shape === name);
              });
              onChange(c.stage);
            });
            if (params[c.key] === name) b.classList.add('on');
            return b;
          };
          CD.SHAPE_TYPES.forEach(function (t) {
            wrap.appendChild(mk(t, t.charAt(0).toUpperCase() + t.slice(1)));
          });
          var customBtn = mk('custom', 'Custom');
          customBtn.classList.add('custom-btn');
          customBtn.disabled = !CD.hasCustomShape();
          wrap.appendChild(customBtn);
          var nodesBtn = mk('nodes', 'Node + link');
          nodesBtn.classList.add('custom-btn');
          wrap.appendChild(nodesBtn);
          row.appendChild(wrap);

          var up = el('div', 'upload-row');
          var upBtn = el('button', 'mini', 'Upload shape SVG');
          upBtn.addEventListener('click', function () { hooks.pickShape(); });
          up.appendChild(upBtn);
          var upName = el('span', 'file-name', '');
          up.appendChild(upName);
          row.appendChild(up);

          /* Two more slots, for the node/link pair. Either falls back to a
           * plain circle until an SVG is loaded into it. */
          var pairWrap = el('div', 'pair-uploads');
          pairWrap.appendChild(el('p', 'help', 'Node + link: shape 1 lands every ' +
            'Nth step along the line, shape 2 fills the run between.'));
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
            pairWrap.appendChild(prow);
          });
          row.appendChild(pairWrap);

          refs[c.key] = {
            set: function (v) {
              wrap.querySelectorAll('.shape-btn').forEach(function (o) {
                o.classList.toggle('on', o.dataset.shape === v);
              });
            },
            customLoaded: function (name) {
              customBtn.disabled = false;
              upName.textContent = name;
            },
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

        if (c.help) row.appendChild(el('p', 'help', c.help));
        row.dataset.modes = c.modes ? c.modes.join(' ') : '';
        sec.appendChild(row);
      });

      sections.push(sec);
      root.appendChild(sec);
    });

    /* A control belonging to a layer is shown while that layer is on, and a
     * group whose every control is hidden goes with it. Controls that list no
     * layer — line spacing, the dot controls — serve both. */
    function syncVisibility() {
      sections.forEach(function (sec) {
        var shown = 0;
        sec.querySelectorAll('.ctrl').forEach(function (r) {
          var m = r.dataset.modes;
          var vis = !m || m.split(' ').some(function (k) {
            return k === 'edge' ? !!params.edgeLayer : !!params.surfaceLayer;
          });
          r.hidden = !vis;
          if (vis) shown++;
        });
        sec.hidden = shown === 0;
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
    SCHEMA: SCHEMA, STAGES: STAGES, FIXED: FIXED,
    defaults: defaults, buildPanel: buildPanel, earliest: earliest
  };
})(CD);
