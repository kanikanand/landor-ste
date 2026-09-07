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

  var SCHEMA = [
    {
      group: 'Depth source', hint: 'Where field 1 comes from.',
      controls: [
        { key: 'modelDepth', label: 'Estimate depth (Depth Anything V2)', type: 'toggle',
          def: false, stage: 'depth',
          help: 'Reads geometry instead of brightness. First use downloads the ' +
                'model; the page must be served over http, not opened as a file.' },
        { key: 'depthPreview', label: 'Show depth map', type: 'toggle', def: false,
          stage: 'draw',
          help: 'Draws field 1 behind the dots, to check it. Not exported to SVG.' }
      ]
    },
    {
      group: 'Silhouette', hint: 'Where the subject ends. Read before any relief smoothing.',
      controls: [
        { key: 'useAlpha', label: 'Use image alpha', type: 'toggle', def: true, stage: 'depth',
          help: 'A cutout carries an exact silhouette, including parts too dark ' +
                'to threshold. Used automatically when the image has one.' },
        { key: 'maskThreshold', label: 'Silhouette cut', min: 0, max: 0.95, step: 0.01,
          def: 0.06, stage: 'depth',
          help: 'The luminance that counts as subject rather than background. ' +
                'Ignored when an alpha silhouette is in use.' },
        { key: 'maskSmoothing', label: 'Silhouette cleanup', min: 0, max: 8, step: 1, def: 1,
          stage: 'depth',
          help: 'Settles a noisy edge. Keep it low — this is the one blur that ' +
                'can push the silhouette off the subject.' }
      ]
    },
    {
      group: 'Overlay', hint: 'Dot part of the subject; leave the rest showing.',
      controls: [
        { key: 'showPhoto', label: 'Show photograph', type: 'toggle', def: false,
          stage: 'draw',
          help: 'Draws the source image under the dots. Where no dots fall it ' +
                'is simply not covered, so it stays the original picture.' },
        { key: 'photoFade', label: 'Photo fade', min: 0, max: 1, step: 0.01, def: 0,
          stage: 'draw',
          help: 'Sinks the photograph towards the background colour, so the ' +
                'dots carry more of the image.' },
        { key: 'wipe', label: 'Partial overlay', type: 'toggle', def: false,
          stage: 'region',
          help: 'Confines the dots to one side of a line, intersected with the ' +
                'subject so they never run onto the background.' },
        { key: 'wipePosition', label: 'Wipe position', min: 0, max: 1, step: 0.01,
          def: 0.5, stage: 'region' },
        { key: 'wipeAngle', label: 'Wipe angle', min: 0, max: 360, step: 1, def: 0,
          stage: 'region',
          help: 'The direction the dots run towards. Add 180 to swap sides.' },
        { key: 'wipeFeather', label: 'Wipe softness', min: 0, max: 0.6, step: 0.01,
          def: 0.12, stage: 'region' },
        { key: 'edgeDissolve', label: 'Edge dissolve', min: 0, max: 1, step: 0.01,
          def: 0.7, stage: 'dots',
          help: 'Shrinks dots away across the edge instead of cutting them off ' +
                'mid-row. This is what sells the transition.' }
      ]
    },
    {
      group: 'Image', hint: 'The photograph, before it becomes a surface.',
      controls: [
        { key: 'threshold', label: 'Depth floor', min: 0, max: 0.95, step: 0.01, def: 0.13, stage: 'depth',
          help: 'Where the relief starts from. Everything below flattens to zero ' +
                'depth; the silhouette is cut separately, above.' },
        { key: 'imageContrast', label: 'Contrast', min: 0.2, max: 4, step: 0.05, def: 1.35, stage: 'depth' },
        { key: 'invert', label: 'Invert depth', type: 'toggle', def: false, stage: 'depth',
          help: 'Use when the subject is lit dark-on-light.' }
      ]
    },
    {
      group: 'Depth', hint: 'Field 1. Black is far, white is near.',
      controls: [
        { key: 'depthExaggeration', label: 'Depth exaggeration', min: 0, max: 30, step: 0.1, def: 3, stage: 'dots',
          help: 'Shifts each dot along the smoothed relief field. This is the ' +
                'relief. It now applies across the whole surface rather than ' +
                'only at edges, so it bites harder per unit than it used to.' },
        { key: 'depthContrast', label: 'Depth contrast', min: 0.2, max: 4, step: 0.05, def: 1.6, stage: 'depth',
          help: 'Steepens near against far.' },
        { key: 'depthSmoothing', label: 'Depth smoothing', min: 0, max: 30, step: 1, def: 10, stage: 'depth',
          help: 'Turns a noisy photo into a continuous surface. Contours need this.' },
        { key: 'reliefCoherence', label: 'Relief coherence', min: 0, max: 24, step: 1, def: 10,
          stage: 'depth',
          help: 'How far the relief displacement is smoothed before it is applied. ' +
                'Low values let neighbouring dots shift by different amounts and ' +
                'tear the contours apart.' }
      ]
    },
    {
      group: 'Contours', hint: 'Field 2. Flow runs along the iso-depth lines.',
      controls: [
        { key: 'lineDensity', label: 'Line density', min: 0.2, max: 4, step: 0.05, def: 1, stage: 'lines' },
        { key: 'lineSpacing', label: 'Line spacing', min: 2, max: 60, step: 0.5, def: 9, stage: 'lines' },
        { key: 'flowStrength', label: 'Flow strength', min: 0, max: 1, step: 0.01, def: 0.88, stage: 'flow',
          help: '0 = straight lines at the base angle, 1 = pure depth contours.' },
        { key: 'flowDistortion', label: 'Flow distortion', min: 0, max: 1, step: 0.01, def: 0.06, stage: 'flow' },
        { key: 'flowAngle', label: 'Base angle', min: 0, max: 180, step: 1, def: 0, stage: 'flow',
          help: 'Direction the lines fall back to where the surface is flat.' },
        { key: 'flowSmoothing', label: 'Flow coherence', min: 0, max: 24, step: 1, def: 6, stage: 'flow',
          help: 'Diffuses direction into flat regions so lines stay continuous.' }
      ]
    },
    {
      group: 'Dots', hint: 'Oriented primitives, not particles.',
      controls: [
        { key: 'gridFill', label: 'Grid fill', type: 'toggle', def: false, stage: 'dots',
          help: 'A lattice instead of dots strung along the contours. Reads as ' +
                'a halftone on broad flat surfaces, where contours wander.' },
        { key: 'shapeType', label: 'Shape', type: 'shape', def: 'circle', stage: 'draw' },
        { key: 'dotSize', label: 'Dot size', min: 0.3, max: 14, step: 0.1, def: 2.2, stage: 'dots' },
        { key: 'sizeVariation', label: 'Size variation', min: 0, max: 1, step: 0.01, def: 0.18, stage: 'dots' },
        { key: 'sizeFalloff', label: 'Size falloff', min: 0.3, max: 3.5, step: 0.05, def: 1.35, stage: 'dots',
          help: 'The curve of the depth \u2192 size channel; its strength is set ' +
                'under Depth mapping.' },
        { key: 'dotSpacing', label: 'Dot spacing', min: 1.5, max: 40, step: 0.25, def: 5, stage: 'dots' },
        { key: 'randomness', label: 'Randomness', min: 0, max: 1, step: 0.01, def: 0.12, stage: 'dots' },
        { key: 'jitterAlong', label: 'Jitter along', min: 0, max: 1, step: 0.01, def: 0.75,
          stage: 'dots',
          help: 'How much of the randomness runs along the contour rather than ' +
                'across it. Along is nearly invisible; across is what breaks the ' +
                'lines up. 1 keeps the lines intact.' }
      ]
    },
    {
      group: 'Depth mapping', hint: 'One signal, three channels. Spend it deliberately.',
      controls: [
        { key: 'sizeDepth', label: 'Depth \u2192 size', min: 0, max: 1, step: 0.01, def: 1,
          stage: 'dots',
          help: '0 leaves every dot the same size, whatever the depth.' },
        { key: 'colorDepth', label: 'Depth \u2192 colour', min: 0, max: 1, step: 0.01, def: 1,
          stage: 'dots',
          help: '0 renders the whole field in the near colour, flat.' },
        { key: 'densityDepth', label: 'Depth \u2192 density', min: 0, max: 1, step: 0.01, def: 1,
          stage: 'lines',
          help: '0 spaces the contours and the dots along them evenly across the ' +
                'whole region, so a selected segment is covered the same in its ' +
                'lights and its darks.' },
        { key: 'fadeDepth', label: 'Depth \u2192 opacity', min: 0, max: 1, step: 0.01, def: 0,
          stage: 'dots',
          help: 'Off by default: opacity is the channel that most easily turns ' +
                'a halftone into haze.' },
        { key: 'tintFromImage', label: 'Tint from image', type: 'toggle', def: false,
          stage: 'dots',
          help: 'Colour follows the picture\u2019s own tone rather than depth, so ' +
                'size can carry the geometry while colour carries the photograph.' }
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

      g.controls.forEach(function (c) {
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
          refs[c.key] = { set: function (v) { cb.checked = !!v; } };

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
          refs[c.key] = { set: function (v) { ci.value = v; } };

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

          refs[c.key] = {
            set: function (v) {
              wrap.querySelectorAll('.shape-btn').forEach(function (o) {
                o.classList.toggle('on', o.dataset.shape === v);
              });
            },
            customLoaded: function (name) {
              customBtn.disabled = false;
              upName.textContent = name;
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
            onChange(c.stage, c.key);
          });
          row.appendChild(sl);
          refs[c.key] = {
            set: function (v) { sl.value = v; val.textContent = fmt(v, c.step); }
          };
        }

        if (c.help) row.appendChild(el('p', 'help', c.help));
        sec.appendChild(row);
      });

      root.appendChild(sec);
    });

    return {
      refs: refs,
      syncAll: function () {
        SCHEMA.forEach(function (g) {
          g.controls.forEach(function (c) {
            if (refs[c.key] && refs[c.key].set) refs[c.key].set(params[c.key]);
          });
        });
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
