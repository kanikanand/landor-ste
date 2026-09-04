/* ============================================================================
 * ui.js — declarative control panel.
 *
 * Every control declares which pipeline stage it dirties, so moving a dot
 * slider does not rebuild the depth field or re-trace the contours. The stages
 * cascade: depth -> flow -> lines -> dots -> draw.
 *
 * Controls sit in a two-column grid and toggles share a row, so the whole
 * panel fits a laptop window without scrolling; the export buttons are pinned
 * below it rather than living at the end of a scroll.
 * ==========================================================================*/
var CD = window.CD || {};

(function (CD) {
  'use strict';

  var STAGES = ['depth', 'flow', 'lines', 'dots', 'draw'];

  var MODES = [
    { key: 'edge', label: 'Edge' },
    { key: 'surface', label: 'Surface' }
  ];

  /* `wide` spans both columns. `inline` toggles are gathered into one row. */
  var SCHEMA = [
    {
      group: 'Render',
      controls: [
        { key: 'renderMode', label: 'Mode', type: 'mode', def: 'edge', stage: 'flow', wide: true }
      ]
    },
    {
      group: 'Image',
      controls: [
        { key: 'threshold', label: 'Threshold', min: 0, max: 0.95, step: 0.01, def: 0.2, stage: 'depth',
          help: 'Where the subject ends and the background begins.' },
        { key: 'imageContrast', label: 'Contrast', min: 0.2, max: 4, step: 0.05, def: 1.35, stage: 'depth' },
        { key: 'invert', label: 'Invert depth', type: 'toggle', def: false, stage: 'depth', inline: true,
          help: 'For a subject that is dark against a light ground.' },
        { key: 'largestRegion', label: 'Largest region', type: 'toggle', def: true, stage: 'depth', inline: true,
          help: 'Keeps one subject, so a stray background patch cannot grow its own silhouette.' },
        { key: 'showImage', label: 'Show image', type: 'toggle', def: true, stage: 'draw', inline: true,
          help: 'Draws the photograph under the dots, and embeds it in the SVG export.' }
      ]
    },
    {
      /* Both of these do real work in either renderer: depth contrast feeds the
       * threshold that defines the silhouette, and the exaggeration displaces
       * dots along the depth gradient wherever they were placed. */
      group: 'Depth',
      controls: [
        { key: 'depthExaggeration', label: 'Exaggeration', min: 0, max: 30, step: 0.1, def: 6, stage: 'dots',
          help: 'Displaces each dot along the depth gradient. This is the relief.' },
        { key: 'depthContrast', label: 'Depth contrast', min: 0.2, max: 4, step: 0.05, def: 1.6, stage: 'depth' }
      ]
    },
    {
      group: 'Contours',
      controls: [
        { key: 'lineCount', label: 'Number of lines', min: 1, max: 14, step: 1, def: 6, stage: 'lines', modes: ['edge'] },
        { key: 'lineSpacing', label: 'Line spacing', min: 2, max: 60, step: 0.5, def: 14, stage: 'lines' },
        { key: 'shading', label: 'Shading', min: 0, max: 1, step: 0.01, def: 1, stage: 'dots', modes: ['edge'],
          help: 'How much the darks earn extra contours. At 0 every region keeps a single line.' },
        { key: 'shadingFalloff', label: 'Shading falloff', min: 0.2, max: 4, step: 0.05, def: 1, stage: 'dots', modes: ['edge'],
          help: 'Higher confines the shading to the deepest darks.' },
        { key: 'lineSpread', label: 'Spread', type: 'spread', def: 'both', stage: 'lines', modes: ['edge'], wide: true,
          help: 'Which side of the edge the extra contours step towards.' },
        { key: 'lineDensity', label: 'Line density', min: 0.2, max: 4, step: 0.05, def: 1, stage: 'lines', modes: ['surface'] },
        { key: 'flowDistortion', label: 'Flow distortion', min: 0, max: 1, step: 0.01, def: 0.06, stage: 'flow', modes: ['surface'] },
        { key: 'flowSmoothing', label: 'Flow coherence', min: 0, max: 24, step: 1, def: 6, stage: 'flow', modes: ['surface'],
          help: 'Diffuses direction into flat regions so lines stay continuous.' }
      ]
    },
    {
      group: 'Dots',
      controls: [
        { key: '__shapes', label: 'Shapes', type: 'shapes', stage: 'draw', wide: true },
        { key: 'nodeEvery', label: 'Node every', min: 1, max: 40, step: 1, def: 8, stage: 'dots',
          help: 'Steps between shape 1. Everything between is shape 2. At 1 every dot is shape 1.' },
        { key: 'nodeScale', label: 'Node scale', min: 1, max: 8, step: 0.1, def: 2.2, stage: 'dots',
          help: 'How much bigger shape 1 is than shape 2.' },
        { key: 'dotSize', label: 'Dot size', min: 0.3, max: 14, step: 0.1, def: 2.6, stage: 'dots' },
        { key: 'sizeVariation', label: 'Size variation', min: 0, max: 1, step: 0.01, def: 0, stage: 'dots' },
        { key: 'dotSpacing', label: 'Dot spacing', min: 1.5, max: 40, step: 0.25, def: 11, stage: 'dots', wide: true }
      ]
    }
  ];

  /* Held constant rather than exposed. Each was a control that this build
   * pins: the panel stays short and the pinned value is the one that works. */
  var FIXED = {
    /* pipeline safety limits */
    maxLines: 5000,
    maxPoints: 900000,
    maxDots: 160000,
    minLinePoints: 6,
    maxLineLength: 4000,
    flowNoiseScale: 1,
    seed: 12345,

    depthSmoothing: 0,      // no blur on the depth field
    flowStrength: 1,        // pure depth contours
    flowAngle: 0,           // inert once flow strength is 1
    sizeByTone: 0,          // an even mark; tone drives nothing about size
    sizeFalloff: 1,
    edgeFalloff: 0,
    edgeWidth: 34,
    randomness: 0,
    imageOpacity: 1,
    showMask: false,
    glowAmount: 0,
    glowRadius: 12,
    shapeFit: true,
    shapeType: 'nodes',     // always the two-slot node/link pair

    background: '#000000',
    dotColor: '#ed1c24'
  };

  function defaults() {
    var p = {};
    Object.keys(FIXED).forEach(function (k) { p[k] = FIXED[k]; });
    SCHEMA.forEach(function (g) {
      g.controls.forEach(function (c) {
        if (c.def !== undefined) p[c.key] = c.def;
      });
    });
    return p;
  }

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

  function fmt(v, step) {
    if (typeof v !== 'number') return String(v);
    var dp = (step && step < 1) ? (String(step).split('.')[1] || '').length : 0;
    return v.toFixed(Math.min(dp, 2));
  }

  /* --------------------------------------------------------------------------
   * Panel
   * ------------------------------------------------------------------------*/
  function buildPanel(root, params, onChange, hooks) {
    root.innerHTML = '';
    var refs = {};
    var sections = [];

    SCHEMA.forEach(function (g) {
      var sec = el('section', 'group');
      sec.appendChild(el('h2', null, g.group));
      var grid = el('div', 'grid');
      sec.appendChild(grid);

      var toggleRow = null;

      g.controls.forEach(function (c) {
        var row;
        if (c.type === 'toggle' && c.inline) {
          /* consecutive inline toggles share one full-width row */
          if (!toggleRow) {
            toggleRow = el('div', 'ctrl wide toggle-row');
            grid.appendChild(toggleRow);
          }
          row = toggleRow;
        } else {
          toggleRow = null;
          row = el('div', 'ctrl' + (c.wide ? ' wide' : ''));
          grid.appendChild(row);
        }

        if (c.type === 'toggle') {
          var lab = el('label', 'ctrl-toggle');
          if (c.help) lab.title = c.help;
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

        } else if (c.type === 'mode' || c.type === 'spread') {
          var opts = c.type === 'mode' ? MODES : [
            { key: 'both', label: 'Both' },
            { key: 'inside', label: 'Inside' },
            { key: 'outside', label: 'Outside' }
          ];
          row.appendChild(el('label', null, c.label));
          var seg = el('div', 'seg');
          if (c.help) seg.title = c.help;
          opts.forEach(function (o) {
            var b = el('button', 'seg-btn', o.label);
            b.dataset.opt = o.key;
            b.addEventListener('click', function () {
              params[c.key] = o.key;
              seg.querySelectorAll('.seg-btn').forEach(function (x) {
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
              seg.querySelectorAll('.seg-btn').forEach(function (x) {
                x.classList.toggle('on', x.dataset.opt === v);
              });
            }
          };

        } else if (c.type === 'shapes') {
          /* Exactly two slots. Shape 1 is the node, shape 2 the link; either
           * falls back to a plain ellipse until an SVG is loaded. */
          row.appendChild(el('label', null, c.label));
          var names = {};
          CD.PAIR_SLOTS.forEach(function (slot, i) {
            var srow = el('div', 'upload-row');
            var btn = el('button', 'mini shape-slot',
              'Shape ' + (i + 1) + (slot === 'node' ? ' · node' : ' · link'));
            btn.title = 'Upload an SVG for ' + (slot === 'node' ? 'the marked points' : 'the run between them');
            btn.addEventListener('click', function () { hooks.pickShape(slot); });
            srow.appendChild(btn);
            var nm = el('span', 'file-name', 'ellipse');
            srow.appendChild(nm);
            names[slot] = nm;
            row.appendChild(srow);
          });
          refs.__shapes = {
            set: function () {},
            loaded: function (slot, name) {
              if (names[slot]) names[slot].textContent = name;
            }
          };

        } else {
          var top = el('div', 'ctrl-top');
          var lb = el('label', null, c.label);
          if (c.help) lb.title = c.help;
          top.appendChild(lb);
          var val = el('span', 'val', fmt(params[c.key], c.step));
          top.appendChild(val);
          row.appendChild(top);

          var sl = el('input', 'slider');
          sl.type = 'range';
          sl.min = c.min; sl.max = c.max; sl.step = c.step;
          sl.value = params[c.key];
          if (c.help) sl.title = c.help;
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

        if (row !== toggleRow) row.dataset.modes = c.modes ? c.modes.join(' ') : '';
      });

      sections.push({ el: sec, modes: g.modes || null });
      root.appendChild(sec);
    });

    /* Controls belonging to one renderer are hidden in the other, and a group
     * whose every control is hidden goes with them. */
    function syncVisibility() {
      sections.forEach(function (s) {
        if (s.modes && s.modes.indexOf(params.renderMode) < 0) {
          s.el.hidden = true;
          return;
        }
        s.el.hidden = false;
        var shown = 0;
        s.el.querySelectorAll('.ctrl').forEach(function (r) {
          var m = r.dataset.modes;
          var vis = !m || m.split(' ').indexOf(params.renderMode) >= 0;
          r.hidden = !vis;
          if (vis) shown++;
        });
        if (!shown) s.el.hidden = true;
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

  CD.UI = {
    SCHEMA: SCHEMA, STAGES: STAGES, FIXED: FIXED, MODES: MODES,
    defaults: defaults, buildPanel: buildPanel, earliest: earliest
  };
})(CD);
