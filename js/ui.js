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
        { key: 'autoTune', modes: ['behind', 'around', 'within'], label: 'Auto', type: 'toggle', def: true,
          stage: 'depth',
          help: 'Reads the picture and sets brightness, contrast, the subject cutoff ' +
                'and how much grain to ignore. Turn it off to set them by hand.' },
        { key: 'exposure', modes: ['within'], label: 'Brightness', min: -0.45, max: 0.45, step: 0.01, def: 0,
          stage: 'depth',
          help: 'Lifts or lowers the whole picture before anything else reads it. ' +
                'Use it when the subject sits too dark or too bright to separate.' },
        { key: 'imageContrast', modes: ['within'], label: 'Contrast', min: 0.2, max: 4, step: 0.05, def: 1.35,
          stage: 'depth',
          help: 'Separates light from dark. More contrast means the dots swing ' +
                'harder between their near and far look.' },
        { key: 'maskSource', modes: ['behind', 'around', 'within'], label: 'Subject from', type: 'source', def: 'auto',
          stage: 'depth',
          help: 'How the subject is told apart from the background. Brightness ' +
                'draws one line through the tones, so it cannot separate a ' +
                'subject that is partly brighter and partly darker than the ' +
                'background — a lit face with dark hair against a grey wall. ' +
                'Plate is exact if you can shoot the empty set; Cut out needs ' +
                'nothing but a download; a transparent PNG is used automatically.' },
      ],
      more: [
        { key: 'maskThreshold', modes: ['behind', 'around', 'within'], label: 'Cutoff', min: 0, max: 0.95, step: 0.01,
          def: 0.06, stage: 'depth',
          help: 'How dark something can be and still count as the subject rather ' +
                'than the background. Raise it if the background is picking up ' +
                'dots; lower it if parts of the subject are being missed.' },
        { key: 'invert', modes: ['within'], label: 'Invert', type: 'toggle',
          def: false, stage: 'depth',
          help: 'Flips which end reads as near. Nothing else behaves until this ' +
                'is right.' },
        { key: 'depthSmoothing', modes: ['within'], label: 'Smoothing', min: 0, max: 30, step: 1,
          def: 10, stage: 'depth',
          help: 'More treats fine detail as noise and gives long, calm lines. ' +
                'Less keeps panel edges and creases, at the risk of the lines ' +
                'breaking up on a rough photo.' },
        { key: 'maskTolerance', modes: ['behind', 'around', 'within'], label: 'Plate tolerance', min: 0.01, max: 0.5,
          step: 0.005, def: 0.06, stage: 'depth',
          help: 'How much two frames of the same set may differ and still count ' +
                'as the same. Raise it if the background is picking up dots; ' +
                'lower it if parts of the subject are being missed.' },
        { key: 'maskDepthBias', modes: ['behind', 'around', 'within'], label: 'Depth split', min: -0.4, max: 0.4,
          step: 0.01, def: 0, stage: 'depth',
          help: 'Nudges where near stops and far starts, when the subject is ' +
                'being separated by depth.' },
        { key: 'maskFillHoles', modes: ['behind', 'around', 'within'], label: 'Fill holes', type: 'toggle', def: true,
          stage: 'depth',
          help: 'Fills gaps inside the subject where it happens to match the ' +
                'background. Only fills what is fully enclosed, so the outline ' +
                'itself never moves.' },
        { key: 'maskDespeckle', modes: ['behind', 'around', 'within'], label: 'Despeckle', min: 0, max: 8, step: 1,
          def: 2, stage: 'depth',
          help: 'Fills specks and holes in the subject’s edge. Raise it on a ' +
                'grainy or heavily compressed picture; it is what stops the lines ' +
                'shattering into short fragments.' },
        { key: 'depthContrast', modes: ['within'], label: 'Depth range', min: 0.2, max: 4, step: 0.05,
          def: 1.6, stage: 'depth',
          help: 'Pushes near and far further apart, so the form reads more ' +
                'strongly through the dots.' },
        { key: 'threshold', modes: ['within'], label: 'Shadow floor', min: 0, max: 0.95, step: 0.01,
          def: 0.13, stage: 'depth',
          help: 'Everything below this reads as fully far. Raise it to stop dark ' +
                'areas carrying any modelling.' },
        { key: 'useAlpha', needs: 'alpha', modes: ['behind', 'around', 'within'], label: 'Use alpha', type: 'toggle',
          def: true, stage: 'depth',
          help: 'A transparent PNG already knows its own outline exactly, ' +
                'including parts too dark to find any other way.' },
        { key: 'cutoutModel', needs: 'network', modes: ['behind', 'around', 'within'], label: 'Cut out subject', type: 'toggle', def: false,
          stage: 'depth',
          help: 'Runs a matting model in the page to find the subject — the same ' +
                'kind of model rembg uses on the desktop, so a transparent PNG ' +
                'made there works just as well and needs no download. First use ' +
                'fetches the model; the page must be served over http.' },
        { key: 'modelDepth', modes: ['behind', 'around', 'within'], needs: 'network', label: 'AI depth',
          type: 'toggle', def: false, stage: 'depth',
          help: 'Works out the actual geometry instead of guessing from ' +
                'brightness. Slow the first time, and needs the page served over ' +
                'http rather than opened as a file.' },
        { key: 'depthPreview', modes: ['behind', 'around', 'within'], label: 'Preview depth', type: 'toggle', def: false,
          stage: 'draw',
          help: 'Draws the depth reading behind the dots. The quickest way to ' +
                'tell whether the image settings are right before touching ' +
                'anything else.' }
      ]
    },

    {
      group: 'Direction',
      hint: 'Four decisions. The presets are the approved combinations.',
      controls: [
        { key: 'preset', label: 'Preset', type: 'preset', def: 'conceptHero',
          stage: 'depth' },
        { key: 'behaviour', label: 'Behaviour', type: 'behaviour', def: 'form',
          stage: 'depth',
          help: 'What the field does. Form follows the shape of the thing, Trace ' +
                'follows the line where it ends, Gather concentrates towards one point.' },
        { key: 'placement', label: 'Placement', type: 'placement', def: 'none',
          stage: 'depth', help: 'Where the field lives relative to the subject.' },
        { key: 'intensity', label: 'Intensity', type: 'intensity', def: 'hero',
          stage: 'depth',
          help: 'One control for how expressive the field is. It moves density, ' +
                'scale and coverage together so they cannot all be pushed at once.' },
      ],
      more: [
        { key: 'showPhoto', label: 'Photo', type: 'toggle', def: true, stage: 'draw' },
        { key: 'lead', label: 'Led by', type: 'lead', def: 'density', stage: 'depth',
          help: 'Which dimension does the talking. The other two are pulled back ' +
                'towards the middle so they do not compete with it.' },
        { key: 'protect', label: 'Protect subject', min: 0, max: 1, step: 0.01,
          def: 0, stage: 'region',
          help: 'Holds the dots off the part that carries the meaning \u2014 a face, ' +
                'a hand, an interface, a label. Placed at the top of the subject ' +
                'automatically.' },
        { key: 'protectSize', label: 'Protect size', min: 0.3, max: 3, step: 0.05,
          def: 1, stage: 'region' },
        { key: 'copySpace', label: 'Copy space', min: 0, max: 0.7, step: 0.01,
          def: 0, stage: 'region',
          help: 'Keeps one side of the frame clear for the headline, by design ' +
                'rather than by cropping afterwards.' },
        { key: 'copyAngle', label: 'Copy side', min: 0, max: 360, step: 90, def: 270,
          stage: 'region' },
        { key: 'wipe', label: 'Reveal', type: 'toggle', def: false, stage: 'region' },
        { key: 'wipePosition', label: 'Reveal position', min: 0, max: 1, step: 0.01,
          def: 0.45, stage: 'region' },
        { key: 'wipeAngle', label: 'Reveal angle', min: 0, max: 360, step: 1, def: 0,
          stage: 'region' },
        { key: 'wipeFeather', label: 'Reveal softness', min: 0, max: 0.6, step: 0.01,
          def: 0.2, stage: 'region' },
        { key: 'photoWipe', label: 'Photo hand-over', min: 0, max: 1, step: 0.01,
          def: 0.85, stage: 'draw' },
        { key: 'photoFade', label: 'Photo fade', min: 0, max: 1, step: 0.01, def: 0,
          stage: 'draw' },
        { key: 'edgeBand', label: 'Band width', min: 4, max: 60, step: 1, def: 12,
          stage: 'region' }
      ]
    },

    {
      group: 'Field',
      hint: 'The shape the dots resolve into when there is no photograph.',
      controls: [
        { key: 'converge', modes: ['none'], label: 'Expand \u2194 converge', min: 0, max: 1,
          step: 0.01, def: 0.7, stage: 'depth',
          help: 'One axis through three readings: expansion at 0, alignment in ' +
                'the middle, convergence at 1.' },
        { key: 'focusX', modes: ['none'], label: 'Focus across', min: 0, max: 1, step: 0.01, def: 0.5,
          stage: 'depth' },
        { key: 'focusY', modes: ['none'], label: 'Focus down', min: 0, max: 1, step: 0.01, def: 0.45,
          stage: 'depth' }
      ],
      more: [
        { key: 'focusReach', modes: ['none'], label: 'Focus reach', min: 0.1, max: 1.2, step: 0.01,
          def: 0.42, stage: 'depth' },
        { key: 'fieldAngle', modes: ['none'], label: 'Direction', min: 0, max: 360, step: 1, def: 0,
          stage: 'depth' },
        { key: 'starPoints', modes: ['none'], label: 'Star points', min: 3, max: 12, step: 1, def: 5,
          stage: 'depth',
          help: 'A stand-in for the real mark\u2019s construction. Replace it with ' +
                'the logo geometry before using this for anything real.' },
        { key: 'starInfluence', modes: ['none'], label: 'Star influence', min: 0, max: 1, step: 0.01,
          def: 0.45, stage: 'depth',
          help: 'How strongly the geometry organises the field. It is a resolution ' +
                'point, never a shape scattered through the pattern.' }
      ]
    },

    {
      group: 'Pattern',
      hint: 'How the dots are drawn.',
      controls: [
        { key: 'flowStrength', label: 'Grid ↔ form', min: 0, max: 1,
          step: 0.01, def: 0.9, stage: 'flow',
          help: 'At 0 the rows run straight and the dots read as a grid. At 1 ' +
                'they wrap around the form. Everything in between is a mix.' },
        { key: 'connect', label: 'Join into nodes', min: 0, max: 1, step: 0.01, def: 0,
          stage: 'draw',
          help: 'Draws each row as a line through its own dots, so the field ' +
                'reads as a network instead of loose points. 0 is dots only.' },
      ],
      more: [
        { key: 'dotSize', label: 'Size', min: 0.3, max: 14, step: 0.1, def: 2.0,
          stage: 'dots' },
        { key: 'dotSpacing', label: 'Spacing', min: 1.5, max: 40, step: 0.25,
          def: 4, stage: 'dots' },
        { key: 'edgeDissolve', label: 'Edge fade', min: 0, max: 1, step: 0.01,
          def: 0.85, stage: 'dots',
          help: 'Shrinks dots away as they reach the edge of where they are ' +
                'allowed, instead of stopping mid-row.' },
        { key: 'flowAngle', label: 'Angle', min: 0, max: 360, step: 1, def: 0,
          stage: 'flow',
          help: 'Which way the straight rows run. Also the direction the dots ' +
                'line up along.' },
        { key: 'rowAlign', label: 'Align rows', min: 0, max: 1, step: 0.01,
          def: 0, stage: 'dots',
          help: 'Locks the dots to a shared rhythm so they form columns as well ' +
                'as rows. Strongest where the rows run straight.' },
        { key: 'sizeVariation', label: 'Size varies', min: 0, max: 1, step: 0.01,
          def: 0.12, stage: 'dots',
          help: 'Random spread in dot size, for texture.' },
        { key: 'randomness', label: 'Scatter', min: 0, max: 1, step: 0.01, def: 0.06,
          stage: 'dots',
          help: 'Loosens the spacing so the pattern stops looking mechanical.' },
        { key: 'depthExaggeration', modes: ['within'], label: 'Relief', min: 0, max: 30,
          step: 0.1, def: 2, stage: 'dots',
          help: 'Shifts dots outwards where the surface bulges towards you, so ' +
                'the rows read as relief rather than as a flat map.' },
        { key: 'reliefCoherence', modes: ['within'], label: 'Relief smoothing', min: 0, max: 24,
          step: 1, def: 10, stage: 'depth',
          help: 'Neighbouring dots move together. Low values let them move ' +
                'differently and tear the rows apart.' },
      ]
    },

    {
      group: 'Look',
      hint: 'Colour, and what changes from near to far.',
      controls: [
        { key: 'sizeDepth', label: 'Size varies', min: 0, max: 1, step: 0.01, def: 1,
          stage: 'dots',
          help: '0 keeps every dot the same size. Uniform dots stay legible as ' +
                'dots; large ones merge into fill where the surface is near.' },
        { key: 'colorDepth', label: 'Colour varies', min: 0, max: 1, step: 0.01,
          def: 1, stage: 'dots',
          help: '0 renders everything in the dot colour, flat.' },
        { key: 'palette', label: 'Palette', type: 'palette', def: 0, stage: 'draw',
          help: 'Approved pairs, checked for contrast. A colour well is that ' +
                'decision handed back to whoever is in a hurry.' },
        { key: 'densityDepth', label: 'Density varies', min: 0, max: 1, step: 0.01,
          def: 1, stage: 'lines',
          help: '0 covers the whole area evenly, lights and darks alike. Use it ' +
                'when you have chosen an area and want all of it.' }
      ],
      more: [
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

    /* Settled once and no longer worth a control: a shape that is always a
     * circle, and the second-order curves whose strengths are already exposed
     * as Depth response. Kept as parameters so the renderer and the exporter
     * need no special cases. */
    shapeType: 'circle',
    lineDensity: 1,
    flowDistortion: 0,
    jitterAlong: 0.85,
    sizeFalloff: 1.35,
    colorGamma: 1,

    /* Written by a preset rather than by a control, but never left undefined:
     * a reset has to land somewhere valid before a preset is applied. */
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

    /* A control that cannot do anything in the current mode is worse than a
     * missing one: it invites a change that has no effect, and quietly teaches
     * that the panel is not to be trusted. Background and Edge read nothing
     * from the picture except the line between subject and ground — their
     * depth is distance to that outline — so every tonal control is noise in
     * them; and every separation control is noise in Full, which covers the
     * whole frame and so has no outside to find. */
    var rowModes = [];
    var needRows = [];
    var sections = [];

    SCHEMA.forEach(function (g) {
      var sec = el('section', 'group');
      sections.push({ sec: sec, group: g });
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
        if (c.modes) rowModes.push({ row: row, modes: c.modes });
        if (c.needs) needRows.push({ row: row, needs: c.needs, control: c });

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

        } else if (c.type === 'preset' || c.type === 'behaviour' ||
                   c.type === 'placement' || c.type === 'intensity' ||
                   c.type === 'lead' || c.type === 'palette') {
          /* One renderer for every button group. They differ only in what
           * fills them, so four near-identical blocks were four places for the
           * same bug to hide. */
          var A = CD.Art;
          /* Six named layouts is a list, not a row of buttons: buttons wrap,
           * and a wrapping row of six is taller than the section it sits in. */
          if (c.type === 'preset') {
            row.appendChild(el('label', null, c.label));
            var sel = el('select', 'preset-select');
            A.PRESET_ORDER.forEach(function (k) {
              var op = el('option', null, A.PRESETS[k].label);
              op.value = k;
              op.title = A.PRESETS[k].note;
              sel.appendChild(op);
            });
            sel.value = params[c.key];
            sel.addEventListener('change', function () {
              params[c.key] = sel.value;
              onChange(c.stage, c.key);
            });
            row.appendChild(sel);
            addRef(refs, c.key, { set: function (v) { sel.value = v; } });
            if (c.help) row.title = c.label + ' — ' + c.help;
            into.appendChild(row);
            return;
          }
          var opts =
            c.type === 'preset' ? A.PRESET_ORDER.map(function (k) {
                return [A.PRESETS[k].label, k, A.PRESETS[k].note]; }) :
            c.type === 'behaviour' ? Object.keys(A.BEHAVIOUR).map(function (k) {
                return [A.BEHAVIOUR[k].label, k, A.BEHAVIOUR[k].hint]; }) :
            c.type === 'placement' ? Object.keys(A.PLACEMENT).map(function (k) {
                return [A.PLACEMENT[k].label, k, '']; }) :
            c.type === 'intensity' ? Object.keys(A.INTENSITY).map(function (k) {
                return [A.INTENSITY[k].label, k, '']; }) :
            c.type === 'palette' ? A.PALETTES.map(function (pal, idx) {
                return [pal.label, idx, '']; }) :
            [['Density', 'density', ''], ['Scale', 'scale', ''],
             ['Coverage', 'coverage', '']];

          row.appendChild(el('label', null, c.label));
          var gwrap = el('div', 'shape-row' + (c.type === 'preset' ? ' preset-row' : ''));
          opts.forEach(function (o) {
            var gb = el('button', 'shape-btn', o[0]);
            gb.dataset.pick = String(o[1]);
            if (o[2]) gb.title = o[2];
            if (c.type === 'palette') {
              gb.style.borderLeft = '6px solid ' + A.PALETTES[o[1]].dot;
            }
            gb.addEventListener('click', function () {
              params[c.key] = o[1];
              setRef(refs, c.key, o[1]);
              onChange(c.stage, c.key);
            });
            if (String(params[c.key]) === String(o[1])) gb.classList.add('on');
            gwrap.appendChild(gb);
          });
          row.appendChild(gwrap);
          addRef(refs, c.key, { set: function (v) {
            gwrap.querySelectorAll('.shape-btn').forEach(function (o) {
              o.classList.toggle('on', o.dataset.pick === String(v));
            });
          } });

        } else if (c.type === 'source') {
          row.appendChild(el('label', null, c.label));
          var swrap = el('div', 'shape-row');
          [['Auto', 'auto'], ['Plate', 'backplate'], ['Cut out', 'cutout'],
           ['Depth', 'depth'], ['Bright', 'brightness']].forEach(function (pair) {
            var sb = el('button', 'shape-btn', pair[0]);
            sb.dataset.source = pair[1];
            sb.addEventListener('click', function () {
              params[c.key] = pair[1];
              setRef(refs, c.key, pair[1]);   /* the selection was invisible
                                                 without this: the value moved
                                                 and the panel did not */
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

    /* Show only what the current mode can act on, and hide a section entirely
     * when nothing in it survives. */
    function applyModeVisibility(mode) {
      rowModes.forEach(function (r) {
        r.row.hidden = r.modes.indexOf(mode) === -1;
      });
      sections.forEach(function (x) {
        /* a More button with nothing behind it is a promise the panel cannot
         * keep, so it goes too */
        if (x.group._body) {
          var inner = x.group._body.querySelectorAll('.ctrl');
          var some = false;
          for (var j = 0; j < inner.length; j++) if (!inner[j].hidden) { some = true; break; }
          x.group._toggle.hidden = !some;
          if (!some) x.group._body.hidden = true;
        }
        var rows = x.sec.querySelectorAll('.ctrl');
        var any = false;
        for (var i = 0; i < rows.length; i++) if (!rows[i].hidden) { any = true; break; }
        x.sec.hidden = !any;
      });
    }
    applyModeVisibility(params.placement);

    /* Three controls depend on something outside the panel: one on the image
     * carrying its own outline, two on being able to fetch a model. When that
     * thing is not there they do nothing, and a control that does nothing
     * while looking live is the most confusing kind. Grey them out and put
     * the reason where the value would be. */
    function applyAvailability(avail) {
      needRows.forEach(function (r) {
        var ok = !!avail[r.needs];
        r.row.classList.toggle('unavailable', !ok);
        var input = r.row.querySelector('input, button');
        if (input) input.disabled = !ok;
        var note = r.row.querySelector('.why');
        if (!ok) {
          if (!note) {
            note = el('span', 'why');
            var lab = r.row.querySelector('.ctrl-toggle');
            (lab || r.row).appendChild(note);
          }
          note.textContent = avail.reasons[r.needs] || 'not available';
        } else if (note) {
          note.remove();
        }
      });
    }

    return {
      refs: refs,
      modeChanged: applyModeVisibility,
      availability: applyAvailability,
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
    var A = CD.Art;
    if (A && A.PRESETS[params.preset]) {
      out.push('Preset: ' + A.PRESETS[params.preset].label);
      out.push('  ' + A.PRESETS[params.preset].note);
      out.push('');
      out.push('Content:   ' + (A.CONTENT[params.content] || {}).label +
               '   — ' + (A.CONTENT[params.content] || {}).rule);
      out.push('Behaviour: ' + (A.BEHAVIOUR[params.behaviour] || {}).label +
               '   — ' + (A.BEHAVIOUR[params.behaviour] || {}).hint);
      out.push('Placement: ' + (A.PLACEMENT[params.placement] || {}).label);
      out.push('Intensity: ' + (A.INTENSITY[params.intensity] || {}).label +
               ', led by ' + params.lead);
      out.push('');
    }
    SCHEMA.forEach(function (g) {
      var before = out.length;
      out.push(g.group.toUpperCase());
      eachControl(g, function (c) {
        if (c.type === 'mode') return;
        /* a control the mode cannot act on is not part of what made this
         * render, so it is not part of the record either */
        if (c.modes && c.modes.indexOf(params.mode) === -1) return;
        var v = params[c.key];
        if (v === undefined) return;
        if (typeof v === 'number' && c.step && c.step < 1) v = v.toFixed(2);
        out.push('  ' + c.label + ': ' + v);
      });
      if (out.length === before + 1) out.length = before;   // nothing applied
      else out.push('');
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
