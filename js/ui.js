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

  /* region sits between depth and flow: it depends on the depth mask, and the
   * tracer and the dots both read it, but the flow field never does. */
  var STAGES = ['depth', 'region', 'flow', 'lines', 'dots', 'draw'];

  /* --------------------------------------------------------------------------
   * The panel.
   *
   * Four questions, asked in the order you actually answer them:
   *
   *   1  IMAGE    what the tool is looking at in your picture
   *   2  PLACE    where the dots go
   *   3  PATTERN  what the dots look like
   *   4  COLOUR
   *
   * Each section shows the few controls that matter and folds the rest away
   * behind "More". Labels say what you will see change, not what the code
   * does — a control called "Flow coherence" is only honest if you already
   * know there is a flow field, and if you do not, it is a dice roll.
   * ------------------------------------------------------------------------*/
  var SCHEMA = [
    {
      group: 'Image',
      hint: 'What the tool reads. Every mode builds on this.',
      controls: [
        { key: 'autoTune', label: 'Auto', type: 'toggle', def: true,
          stage: 'depth',
          help: 'Reads the picture and sets brightness, contrast, the subject cutoff ' +
                'and how much grain to ignore. Turn it off to set them by hand.' },
        { key: 'exposure', label: 'Brightness', min: -0.45, max: 0.45, step: 0.01, def: 0,
          stage: 'depth',
          help: 'Lifts or lowers the whole picture before anything else reads it. ' +
                'Use it when the subject sits too dark or too bright to separate.' },
        { key: 'imageContrast', label: 'Contrast', min: 0.2, max: 4, step: 0.05, def: 1.35,
          stage: 'depth',
          help: 'Separates light from dark. More contrast means the dots swing ' +
                'harder between their near and far look.' },
        { key: 'maskSource', label: 'Subject from', type: 'source', def: 'auto',
          stage: 'depth',
          help: 'How the subject is told apart from the background. Brightness ' +
                'draws one line through the tones, so it cannot separate a ' +
                'subject that is partly brighter and partly darker than the ' +
                'background — a lit face with dark hair against a grey wall. ' +
                'Load a frame of the empty set and Plate is exact.' },
      ],
      more: [
        { key: 'maskThreshold', label: 'Cutoff', min: 0, max: 0.95, step: 0.01,
          def: 0.06, stage: 'depth',
          help: 'How dark something can be and still count as the subject rather ' +
                'than the background. Raise it if the background is picking up ' +
                'dots; lower it if parts of the subject are being missed.' },
        { key: 'invert', label: 'Invert', type: 'toggle',
          def: false, stage: 'depth',
          help: 'Flips which end reads as near. Nothing else behaves until this ' +
                'is right.' },
        { key: 'depthSmoothing', label: 'Smoothing', min: 0, max: 30, step: 1,
          def: 10, stage: 'depth',
          help: 'More treats fine detail as noise and gives long, calm lines. ' +
                'Less keeps panel edges and creases, at the risk of the lines ' +
                'breaking up on a rough photo.' },
        { key: 'maskTolerance', label: 'Plate tolerance', min: 0.01, max: 0.5,
          step: 0.005, def: 0.06, stage: 'depth',
          help: 'How much two frames of the same set may differ and still count ' +
                'as the same. Raise it if the background is picking up dots; ' +
                'lower it if parts of the subject are being missed.' },
        { key: 'maskDepthBias', label: 'Depth split', min: -0.4, max: 0.4,
          step: 0.01, def: 0, stage: 'depth',
          help: 'Nudges where near stops and far starts, when the subject is ' +
                'being separated by depth.' },
        { key: 'maskFillHoles', label: 'Fill holes', type: 'toggle', def: true,
          stage: 'depth',
          help: 'Fills gaps inside the subject where it happens to match the ' +
                'background. Only fills what is fully enclosed, so the outline ' +
                'itself never moves.' },
        { key: 'maskDespeckle', label: 'Despeckle', min: 0, max: 8, step: 1,
          def: 2, stage: 'depth',
          help: 'Fills specks and holes in the subject’s edge. Raise it on a ' +
                'grainy or heavily compressed picture; it is what stops the lines ' +
                'shattering into short fragments.' },
        { key: 'maskSmoothing', label: 'Soften edge', min: 0, max: 8, step: 1,
          def: 1, stage: 'depth',
          help: 'Blurs the edge of the subject. Keep it low — this is the one ' +
                'control that can push the outline off the subject.' },
        { key: 'depthContrast', label: 'Depth range', min: 0.2, max: 4, step: 0.05,
          def: 1.6, stage: 'depth',
          help: 'Pushes near and far further apart, so the form reads more ' +
                'strongly through the dots.' },
        { key: 'threshold', label: 'Shadow floor', min: 0, max: 0.95, step: 0.01,
          def: 0.13, stage: 'depth',
          help: 'Everything below this reads as fully far. Raise it to stop dark ' +
                'areas carrying any modelling.' },
        { key: 'useAlpha', label: 'Use alpha', type: 'toggle',
          def: true, stage: 'depth',
          help: 'A transparent PNG already knows its own outline exactly, ' +
                'including parts too dark to find any other way.' },
        { key: 'modelDepth', label: 'AI depth',
          type: 'toggle', def: false, stage: 'depth',
          help: 'Works out the actual geometry instead of guessing from ' +
                'brightness. Slow the first time, and needs the page served over ' +
                'http rather than opened as a file.' },
        { key: 'depthPreview', label: 'Preview depth', type: 'toggle', def: false,
          stage: 'draw',
          help: 'Draws the depth reading behind the dots. The quickest way to ' +
                'tell whether the image settings are right before touching ' +
                'anything else.' }
      ]
    },

    {
      group: 'Place',
      hint: 'Which part of the picture gets dots.',
      controls: [
        { key: 'mode', label: 'Region', type: 'mode', def: 'full', stage: 'depth' },
        { key: 'showPhoto', label: 'Photo', type: 'toggle', def: true,
          stage: 'draw' },
        { key: 'wipe', label: 'Reveal', type: 'toggle', def: true,
          stage: 'region',
          help: 'Hands the subject over from photograph to dots across a line, ' +
                'instead of dotting all of it.' },
      ],
      more: [
        { key: 'wipePosition', label: 'Position', min: 0, max: 1, step: 0.01,
          def: 0.45, stage: 'region',
          help: 'Where the hand-over falls.' },
        { key: 'wipeAngle', label: 'Angle', min: 0, max: 360, step: 1, def: 0,
          stage: 'region',
          help: 'Which way the dots run in from. Add 180 to swap sides.' },
        { key: 'wipeFeather', label: 'Softness', min: 0, max: 0.6, step: 0.01,
          def: 0.16, stage: 'region',
          help: 'How gradually the hand-over happens. 0 is a hard line.' },
        { key: 'photoWipe', label: 'Photo hand-over', min: 0, max: 1,
          step: 0.01, def: 0.85, stage: 'draw',
          help: 'Takes the picture away where the dots take over. At 0 the ' +
                'photograph stays at full strength underneath them.' },
        { key: 'photoFade', label: 'Photo fade', min: 0, max: 1, step: 0.01,
          def: 0, stage: 'draw',
          help: 'Sinks the whole picture towards the background colour, so the ' +
                'dots carry more of it.' },
        { key: 'edgeBand', label: 'Band width', min: 4, max: 60, step: 1, def: 12,
          stage: 'region',
          help: 'How far the pattern reaches either side of the outline. Only ' +
                'used by Background and Edge.' }
      ]
    },

    {
      group: 'Pattern',
      hint: 'How the dots are drawn.',
      controls: [
        { key: 'dotSize', label: 'Size', min: 0.3, max: 14, step: 0.1, def: 2.0,
          stage: 'dots' },
        { key: 'dotSpacing', label: 'Gap', min: 1.5, max: 40, step: 0.25,
          def: 4, stage: 'dots' },
        { key: 'flowStrength', label: 'Grid ↔ follows the form', min: 0, max: 1,
          step: 0.01, def: 0.9, stage: 'flow',
          help: 'At 0 the rows run straight and the dots read as a grid. At 1 ' +
                'they wrap around the form. Everything in between is a mix.' },
        { key: 'edgeDissolve', label: 'Edge fade', min: 0, max: 1, step: 0.01,
          def: 0.85, stage: 'dots',
          help: 'Shrinks dots away as they reach the edge of where they are ' +
                'allowed, instead of stopping mid-row.' }
      ],
      more: [
        { key: 'lineSpacing', label: 'Row gap', min: 2, max: 60, step: 0.5,
          def: 7, stage: 'lines' },
        { key: 'shapeType', label: 'Shape', type: 'shape', def: 'circle', stage: 'draw' },
        { key: 'flowAngle', label: 'Angle', min: 0, max: 360, step: 1, def: 0,
          stage: 'flow',
          help: 'Which way the straight rows run. Also the direction the dots ' +
                'line up along.' },
        { key: 'rowAlign', label: 'Align rows', min: 0, max: 1, step: 0.01,
          def: 0, stage: 'dots',
          help: 'Locks the dots to a shared rhythm so they form columns as well ' +
                'as rows. Strongest where the rows run straight.' },
        { key: 'flowSmoothing', label: 'Form reach', min: 0, max: 24,
          step: 1, def: 6, stage: 'flow',
          help: 'Spreads the direction of the form into flat areas. Low values ' +
                'let those areas fall back to the grid angle.' },
        { key: 'lineDensity', label: 'Row density', min: 0.2, max: 4, step: 0.05, def: 1,
          stage: 'lines' },
        { key: 'sizeVariation', label: 'Size varies', min: 0, max: 1, step: 0.01,
          def: 0.12, stage: 'dots',
          help: 'Random spread in dot size, for texture.' },
        { key: 'randomness', label: 'Scatter', min: 0, max: 1, step: 0.01, def: 0.06,
          stage: 'dots',
          help: 'Loosens the spacing so the pattern stops looking mechanical.' },
        { key: 'jitterAlong', label: 'Scatter along', min: 0, max: 1, step: 0.01,
          def: 0.75, stage: 'dots',
          help: 'Keeps the scatter running along each row rather than across it. ' +
                'Across is what breaks a row up; along barely shows.' },
        { key: 'flowDistortion', label: 'Wobble', min: 0, max: 1, step: 0.01, def: 0.04,
          stage: 'flow',
          help: 'Bends the rows with slow noise so they breathe instead of ' +
                'reading like a survey map.' },
        { key: 'depthExaggeration', label: 'Relief', min: 0, max: 30,
          step: 0.1, def: 2, stage: 'dots',
          help: 'Shifts dots outwards where the surface bulges towards you, so ' +
                'the rows read as relief rather than as a flat map.' },
        { key: 'reliefCoherence', label: 'Relief smoothing', min: 0, max: 24,
          step: 1, def: 10, stage: 'depth',
          help: 'Neighbouring dots move together. Low values let them move ' +
                'differently and tear the rows apart.' },
        { key: 'sizeFalloff', label: 'Falloff curve', min: 0.3, max: 3.5, step: 0.05,
          def: 1.35, stage: 'dots',
          help: 'How quickly dots shrink as the surface turns away.' },
        { key: 'gridFill', label: 'Flat lattice', type: 'toggle',
          def: false, stage: 'dots',
          help: 'Drops the flowing rows entirely for an even lattice. The Grid ' +
                'end of the slider above usually reads better, because it still ' +
                'knows where the form is.' }
      ]
    },

    {
      group: 'Look',
      hint: 'Colour, and what changes from near to far.',
      controls: [
        { key: 'sizeDepth', label: 'Size', min: 0, max: 1, step: 0.01, def: 1,
          stage: 'dots',
          help: '0 keeps every dot the same size. Uniform dots stay legible as ' +
                'dots; large ones merge into fill where the surface is near.' },
        { key: 'colorDepth', label: 'Colour', min: 0, max: 1, step: 0.01,
          def: 1, stage: 'dots',
          help: '0 renders everything in the dot colour, flat.' },
        { key: 'colorNear', label: 'Dots', type: 'color', def: '#ff2233', stage: 'draw' },
        { key: 'background', label: 'Background', type: 'color', def: '#000000', stage: 'draw' },
        { key: 'densityDepth', label: 'Density', min: 0, max: 1, step: 0.01,
          def: 1, stage: 'lines',
          help: '0 covers the whole area evenly, lights and darks alike. Use it ' +
                'when you have chosen an area and want all of it.' }
      ],
      more: [
        { key: 'colorFar', label: 'Far', type: 'color', def: '#4a0410', stage: 'draw',
          help: 'What the dots fade towards as the surface recedes.' },
        { key: 'colorGamma', label: 'Falloff', min: 0.3, max: 3, step: 0.05, def: 1,
          stage: 'draw' },
        { key: 'fadeDepth', label: 'Fade', min: 0, max: 1, step: 0.01, def: 0,
          stage: 'dots',
          help: 'Far dots go transparent. Easily overdone.' },
        { key: 'tintFromImage', label: 'Tint from photo', type: 'toggle',
          def: false, stage: 'dots',
          help: 'Dots pick up the picture’s own tone, so size can carry the ' +
                'form while colour carries the image.' }
      ]
    },

  ];

  /* Values not exposed as sliders: safety limits and the random seed. */
  var FIXED = {
    maxLines: 5000,
    maxPoints: 900000,
    maxDots: 160000,
    minLinePoints: 6,
    maxLineLength: 4000,
    flowNoiseScale: 1,
    seed: 12345,

    /* Written by a preset rather than by a control, but never left undefined:
     * a reset has to land somewhere valid before applyMode runs again. */
    regionSource: 'all',
    fieldSource: 'image',
    edgeBand: 12
  };

  /* Every control in a group, shown or folded away. */
  function eachControl(g, fn) {
    (g.controls || []).forEach(fn);
    (g.more || []).forEach(fn);
  }

  function defaults() {
    var p = {};
    Object.keys(FIXED).forEach(function (k) { p[k] = FIXED[k]; });
    SCHEMA.forEach(function (g) {
      eachControl(g, function (c) { p[c.key] = c.def; });
    });
    return p;
  }

  /* Returns the earliest (most upstream) of two stages. */
  function earliest(a, b) {
    if (!a) return b;
    if (!b) return a;
    return STAGES.indexOf(a) < STAGES.indexOf(b) ? a : b;
  }

  /* A control can be shown in more than one place — the essentials up top and
   * the full set below — and both have to move when the value changes, so a
   * key maps to a list of setters rather than one. */
  function addRef(refs, key, r) {
    (refs[key] || (refs[key] = [])).push(r);
  }

  function setRef(refs, key, v) {
    (refs[key] || []).forEach(function (r) { if (r.set) r.set(v); });
  }

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }

  /* Build the panel. onChange(stage, key) fires on every edit. */
  function buildPanel(root, params, onChange, hooks) {
    root.innerHTML = '';
    var refs = {};

    SCHEMA.forEach(function (g) {
      var sec = el('section', 'group');
      var head = el('div', 'group-head');
      head.appendChild(el('h2', null, g.group));
      if (g.hint) head.appendChild(el('p', 'hint', g.hint));
      sec.appendChild(head);

      /* Detail lives with the thing it details, not in one pile at the
       * bottom: if you are already in Pattern wondering about scatter, the
       * scatter controls should be one click away and nowhere else. */
      var moreBody = null;
      if (g.more && g.more.length) {
        var moreToggle = el('button', 'more-toggle', 'More');
        moreBody = el('div', 'more-body');
        moreBody.hidden = true;
        moreToggle.addEventListener('click', function () {
          moreBody.hidden = !moreBody.hidden;
          moreToggle.classList.toggle('open', !moreBody.hidden);
        });
        g._toggle = moreToggle;
        g._body = moreBody;
      }

      var render = function (c, into) {
        var row = el('div', 'ctrl');

        if (c.type === 'toggle') {
          var lab = el('label', 'ctrl-toggle');
          var cb = el('input');
          cb.type = 'checkbox';
          cb.checked = !!params[c.key];
          cb.addEventListener('change', function () {
            params[c.key] = cb.checked;
            onChange(c.stage, c.key);
          });
          lab.appendChild(cb);
          lab.appendChild(el('span', null, c.label));
          row.appendChild(lab);
          addRef(refs, c.key, { set: function (v) { cb.checked = !!v; } });

        } else if (c.type === 'color') {
          var top = el('div', 'ctrl-top');
          top.appendChild(el('label', null, c.label));
          var ci = el('input', 'color');
          ci.type = 'color';
          ci.value = params[c.key];
          ci.addEventListener('input', function () {
            params[c.key] = ci.value;
            onChange(c.stage, c.key);
          });
          top.appendChild(ci);
          row.appendChild(top);
          addRef(refs, c.key, { set: function (v) { ci.value = v; } });

        } else if (c.type === 'mode') {
          row.appendChild(el('label', null, c.label));
          var mwrap = el('div', 'shape-row mode-row');
          CD.Presets.ORDER.forEach(function (name) {
            var mb = el('button', 'shape-btn', CD.Presets.MODES[name].label);
            mb.dataset.mode = name;
            mb.title = CD.Presets.MODES[name].hint;
            mb.addEventListener('click', function () {
              params[c.key] = name;
              onChange(c.stage, c.key);
            });
            if (params[c.key] === name) mb.classList.add('on');
            mwrap.appendChild(mb);
          });
          row.appendChild(mwrap);
          addRef(refs, c.key, { set: function (v) {
            mwrap.querySelectorAll('.shape-btn').forEach(function (o) {
              o.classList.toggle('on', o.dataset.mode === v);
            });
          } });

        } else if (c.type === 'source') {
          row.appendChild(el('label', null, c.label));
          var swrap = el('div', 'shape-row');
          [['Auto', 'auto'], ['Plate', 'backplate'], ['Depth', 'depth'],
           ['Bright', 'brightness']].forEach(function (pair) {
            var sb = el('button', 'shape-btn', pair[0]);
            sb.dataset.source = pair[1];
            sb.addEventListener('click', function () {
              params[c.key] = pair[1];
              onChange(c.stage, c.key);
            });
            if (params[c.key] === pair[1]) sb.classList.add('on');
            swrap.appendChild(sb);
          });
          row.appendChild(swrap);
          addRef(refs, c.key, { set: function (v) {
            swrap.querySelectorAll('.shape-btn').forEach(function (o) {
              o.classList.toggle('on', o.dataset.source === v);
            });
          } });

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
              onChange(c.stage, c.key);
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
          row.appendChild(wrap);

          var up = el('div', 'upload-row');
          var upBtn = el('button', 'mini', 'Upload shape SVG');
          upBtn.addEventListener('click', function () { hooks.pickShape(); });
          up.appendChild(upBtn);
          var upName = el('span', 'file-name', '');
          up.appendChild(upName);
          row.appendChild(up);

          addRef(refs, c.key, {
            set: function (v) {
              wrap.querySelectorAll('.shape-btn').forEach(function (o) {
                o.classList.toggle('on', o.dataset.shape === v);
              });
            },
            customLoaded: function (name) {
              customBtn.disabled = false;
              upName.textContent = name;
            }
          });

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
            onChange(c.stage, c.key);
          });
          row.appendChild(sl);
          addRef(refs, c.key, {
            set: function (v) { sl.value = v; val.textContent = fmt(v, c.step); }
          });
        }

        /* The explanation goes in the tooltip, not into the layout. Rendering
         * it inline under every row doubled the panel's height; revealing it
         * on hover was worse, because the panel then shifted under the cursor
         * every time a control was touched — you would reach for a slider and
         * the row would move. A title attribute costs no space and never
         * reflows. */
        if (c.help) row.title = c.label + ' — ' + c.help;
        into.appendChild(row);
      };

      (g.controls || []).forEach(function (c) { render(c, sec); });
      if (moreBody) {
        (g.more || []).forEach(function (c) { render(c, moreBody); });
        sec.appendChild(g._toggle);
        sec.appendChild(moreBody);
      }

      root.appendChild(sec);
    });

    return {
      refs: refs,
      set: function (key, v) { setRef(refs, key, v); },
      call: function (key, fn) {
        (refs[key] || []).forEach(function (r) { if (r[fn]) r[fn].apply(null, [].slice.call(arguments, 2)); });
      },
      syncAll: function () {
        Object.keys(refs).forEach(function (k) {
          if (params[k] !== undefined) setRef(refs, k, params[k]);
        });
      }
    };
  }

  function fmt(v, step) {
    if (typeof v !== 'number') return String(v);
    var dp = (step && step < 1) ? (String(step).split('.')[1] || '').length : 0;
    return v.toFixed(Math.min(dp, 2));
  }

  /* A plain-text record of what produced this render, using the same words
   * the panel uses. Written from the schema so it cannot drift out of date. */
  function describe(params, auto) {
    var out = ['Contour Dots — settings', ''];
    if (params.mode && CD.Presets && CD.Presets.MODES[params.mode]) {
      out.push('Mode: ' + CD.Presets.MODES[params.mode].label +
               '  (' + CD.Presets.MODES[params.mode].hint + ')');
      out.push('');
    }
    SCHEMA.forEach(function (g) {
      out.push(g.group.toUpperCase());
      eachControl(g, function (c) {
        if (c.type === 'mode') return;
        var v = params[c.key];
        if (v === undefined) return;
        if (typeof v === 'number' && c.step && c.step < 1) v = v.toFixed(2);
        out.push('  ' + c.label + ': ' + v);
      });
      out.push('');
    });
    if (auto) {
      out.push('WHAT AUTO-ADJUST READ FROM THE IMAGE');
      out.push('  Grain: ' + auto._noise);
      out.push('  Grain after contrast: ' + auto._effective);
      out.push('  Subject tonal range: ' + auto._range);
      out.push('  Background level: ' + auto._bg);
      out.push('  Subject darker than background: ' + (auto.invert ? 'yes' : 'no'));
      out.push('');
    }
    out.push('Generated ' + new Date().toISOString());
    return out.join('\n');
  }

  CD.UI = {
    SCHEMA: SCHEMA, STAGES: STAGES, FIXED: FIXED,
    defaults: defaults, buildPanel: buildPanel, earliest: earliest,
    describe: describe, eachControl: eachControl
  };
})(CD);
