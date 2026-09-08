/* ============================================================================
 * artdirection.js — the system the presets are built from.
 *
 * The earlier modes mixed three different decisions into one list: "full"
 * described placement, "edge" described a behaviour, "background" described
 * placement again. That does not scale, because the moment a new behaviour or
 * a new placement appears every combination has to be re-enumerated.
 *
 * Four independent layers instead:
 *
 *   CONTENT     what is being communicated   concepts | products | people
 *   BEHAVIOUR   what the field does          form | trace | gather
 *   PLACEMENT   where it lives               behind | within | around | none
 *   INTENSITY   how expressive it is         quiet | supporting | hero
 *
 * They are independent but not a free-for-all: the presets below are the
 * approved combinations, and they are what the panel offers first. The layers
 * are exposed underneath so a considered variation is possible without
 * inventing a new preset for it.
 *
 * One rule holds the whole thing together: CONTENT decides what the dots are
 * for. Concepts — the dots create. Products — the dots reveal. People — the
 * dots support. Every default below is that sentence turned into numbers.
 * ==========================================================================*/
var CD = window.CD || {};

(function (CD) {
  'use strict';

  var clamp = CD.clamp, lerp = CD.lerp;

  /* --------------------------------------------------------------------------
   * The layers
   * ------------------------------------------------------------------------*/

  var CONTENT = {
    concepts: { label: 'Concepts', rule: 'The dots create.' },
    products: { label: 'Products', rule: 'The dots reveal.' },
    people:   { label: 'People',   rule: 'The dots support.' }
  };

  /* What the field does. Behaviour chooses the surface the dots read, which
   * is the honest difference between them: form follows the subject's own
   * shape, trace follows the line where it ends, gather follows distance from
   * a focal point. */
  var BEHAVIOUR = {
    form: {
      label: 'Form', field: 'image',
      hint: 'Dots follow the shape of the thing itself.',
      params: { flowStrength: 0.9, rowAlign: 0.3, densityDepth: 0.8,
                sizeDepth: 0.85, colorDepth: 1, depthExaggeration: 2 }
    },
    trace: {
      label: 'Trace', field: 'distance',
      hint: 'Dots follow the line where the subject ends.',
      params: { flowStrength: 1, rowAlign: 0.6, densityDepth: 0.15,
                sizeDepth: 0.35, colorDepth: 0.4, depthExaggeration: 0 }
    },
    gather: {
      label: 'Gather', field: 'focus',
      hint: 'Dots concentrate towards one point and thin away from it.',
      params: { flowStrength: 0.85, rowAlign: 0.5, densityDepth: 1,
                sizeDepth: 0.7, colorDepth: 0.7, depthExaggeration: 0 }
    }
  };

  var PLACEMENT = {
    behind: { label: 'Behind', region: 'background' },
    within: { label: 'Within', region: 'subject' },
    around: { label: 'Around', region: 'edge' },
    none:   { label: 'Whole frame', region: 'all' }
  };

  /* --------------------------------------------------------------------------
   * Intensity, and the restraint that keeps it from reading as noise
   *
   * Intensity is deliberately ONE control that moves several numbers together.
   * Exposing density, scale and coverage separately invites all three to be
   * pushed at once, which is how a system stops looking engineered.
   *
   * The lead parameter is the other half of that restraint: whichever
   * dimension is doing the talking gets its full range, and the others are
   * pulled back towards the middle so they do not compete with it.
   * ------------------------------------------------------------------------*/

  var INTENSITY = {
    quiet:      { label: 'Quiet',      t: 0.18 },
    supporting: { label: 'Supporting', t: 0.55 },
    hero:       { label: 'Hero',       t: 1.00 }
  };

  /* Dot scale stays inside a narrow band whatever else happens: one circular
   * primitive with a limited size range is the first line of the visual DNA,
   * and a slider that can reach a blob has already broken it. */
  var SIZE_MIN = 1.1, SIZE_MAX = 3.4;
  var SPACING_MIN = 2.6, SPACING_MAX = 9.0;

  function applyIntensity(params, level, lead) {
    var t = (INTENSITY[level] || INTENSITY.supporting).t;

    /* the leading dimension gets the full swing, the others are damped
     * towards their middle so one thing is clearly doing the talking */
    var damp = function (v) { return lerp(0.5, v, 0.35); };
    var tDensity = lead === 'density' ? t : damp(t);
    var tScale   = lead === 'scale'   ? t : damp(t);
    var tCover   = lead === 'coverage' ? t : damp(t);

    /* denser means closer together, so spacing runs the other way */
    params.dotSpacing = lerp(SPACING_MAX, SPACING_MIN, tDensity);
    params.dotSize = lerp(SIZE_MIN, SIZE_MAX, tScale);
    params.edgeDissolve = lerp(0.9, 0.45, tCover);
    params.photoWipe = lerp(0.25, 0.95, tCover);
    params.randomness = lerp(0.02, 0.09, tScale);
    return params;
  }

  /* --------------------------------------------------------------------------
   * The approved presets
   *
   * Six repeatable layouts rather than a set of guidelines, because a
   * guideline gets interpreted and a preset gets used. Each names its four
   * layers; the numbers come from the layers, not from the preset, so a
   * change to a behaviour reaches every preset that uses it.
   * ------------------------------------------------------------------------*/

  var PRESETS = {
    conceptHero: {
      label: 'Concept · Hero',
      note: 'A large expressive field and no photograph. The dots are the image.',
      content: 'concepts', behaviour: 'form', placement: 'none',
      intensity: 'hero', lead: 'density',
      params: { showPhoto: false, wipe: false, copySpace: 0.32, copyAngle: 270,
                starPoints: 5, converge: 0.75, fieldSource: 'generative' }
    },
    conceptQuiet: {
      label: 'Concept · Quiet',
      note: 'A sparse field or a cropped fragment, supporting type rather than competing with it.',
      content: 'concepts', behaviour: 'form', placement: 'none',
      intensity: 'quiet', lead: 'coverage',
      params: { showPhoto: false, wipe: false, copySpace: 0.5, copyAngle: 270,
                starPoints: 5, converge: 0.4, fieldSource: 'generative' }
    },
    peopleEnvironmental: {
      label: 'People · Environmental',
      note: 'Dots behind and around the person. The face is never touched.',
      content: 'people', behaviour: 'gather', placement: 'behind',
      intensity: 'supporting', lead: 'density',
      params: { showPhoto: true, wipe: false, protect: 0.55, copySpace: 0 }
    },
    peopleIntegrated: {
      label: 'People · Integrated',
      note: 'A controlled dissolve through clothing and the lower body, face left clear.',
      content: 'people', behaviour: 'form', placement: 'within',
      intensity: 'supporting', lead: 'coverage',
      params: { showPhoto: true, wipe: true, wipeAngle: 90, wipePosition: 0.55,
                wipeFeather: 0.3, protect: 0.7, copySpace: 0 }
    },
    productShowcase: {
      label: 'Product · Showcase',
      note: 'The object stays sharp and intact; the field supports it from behind.',
      content: 'products', behaviour: 'gather', placement: 'behind',
      intensity: 'supporting', lead: 'density',
      params: { showPhoto: true, wipe: false, protect: 0, copySpace: 0.2, copyAngle: 0 }
    },
    productDetail: {
      label: 'Product · Detail',
      note: 'A localised contour along one meaningful edge, opening into the background.',
      content: 'products', behaviour: 'trace', placement: 'around',
      intensity: 'quiet', lead: 'coverage',
      params: { showPhoto: true, wipe: true, wipeAngle: 0, wipePosition: 0.45,
                wipeFeather: 0.25, protect: 0, copySpace: 0 }
    }
  };

  var PRESET_ORDER = ['conceptHero', 'conceptQuiet', 'peopleEnvironmental',
                      'peopleIntegrated', 'productShowcase', 'productDetail'];

  /* --------------------------------------------------------------------------
   * Palette
   *
   * Approved pairs rather than two free colour wells. A pair that has been
   * checked for contrast is a decision already made; a colour picker is that
   * decision handed back to whoever is in a hurry.
   * ------------------------------------------------------------------------*/
  var PALETTES = [
    { label: 'Red on black',  dot: '#ff2233', far: '#4a0410', bg: '#000000' },
    { label: 'Red on bone',   dot: '#e01b2d', far: '#f0d9d4', bg: '#f4efe9' },
    { label: 'Bone on red',   dot: '#f4efe9', far: '#c4172a', bg: '#d81026' },
    { label: 'Neutral',       dot: '#e8e2da', far: '#3a352f', bg: '#14120f' }
  ];

  function applyPalette(params, index) {
    var p = PALETTES[clamp(index | 0, 0, PALETTES.length - 1)];
    params.colorNear = p.dot;
    params.colorFar = p.far;
    params.background = p.bg;
    return params;
  }

  /* --------------------------------------------------------------------------
   * Composing the four layers into parameters
   * ------------------------------------------------------------------------*/

  /* Behaviour and placement together decide the field and the region; the
   * preset's own params are the composition on top. `keep` is the set the
   * user has already made their own, which nothing here overwrites. */
  function compose(params, choice, keep) {
    keep = keep || {};
    var beh = BEHAVIOUR[choice.behaviour] || BEHAVIOUR.form;
    var place = PLACEMENT[choice.placement] || PLACEMENT.none;

    var out = {};
    Object.keys(beh.params).forEach(function (k) { out[k] = beh.params[k]; });
    out.regionSource = place.region;
    /* Concepts have no subject to read, so the field is generated rather than
     * measured; every other behaviour names its own source. */
    out.fieldSource = choice.placement === 'none' ? 'generative' : beh.field;

    applyIntensity(out, choice.intensity, choice.lead);

    var extra = choice.params || {};
    Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });

    /* what defines the choice is always written; the rest yields to the user */
    var DEFINING = { regionSource: 1, fieldSource: 1 };
    Object.keys(out).forEach(function (k) {
      if (DEFINING[k] || !keep[k]) params[k] = out[k];
    });
    return params;
  }

  function applyPreset(params, name, keep) {
    var preset = PRESETS[name] || PRESETS.conceptHero;
    params.content = preset.content;
    params.behaviour = preset.behaviour;
    params.placement = preset.placement;
    params.intensity = preset.intensity;
    params.lead = preset.lead;
    return compose(params, preset, keep);
  }

  CD.Art = {
    CONTENT: CONTENT, BEHAVIOUR: BEHAVIOUR, PLACEMENT: PLACEMENT,
    INTENSITY: INTENSITY, PRESETS: PRESETS, PRESET_ORDER: PRESET_ORDER,
    PALETTES: PALETTES,
    SIZE_MIN: SIZE_MIN, SIZE_MAX: SIZE_MAX,
    compose: compose, applyPreset: applyPreset,
    applyIntensity: applyIntensity, applyPalette: applyPalette
  };
})(CD);
