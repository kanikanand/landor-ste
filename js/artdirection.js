/* ============================================================================
 * artdirection.js — the system the presets are built from.
 *
 * The earlier modes mixed three different decisions into one list: "full"
 * described placement, "edge" described a behaviour, "background" described
 * placement again. That does not scale, because the moment a new behaviour or
 * a new placement appears every combination has to be re-enumerated.
 *
 * Five independent layers instead:
 *
 *   CONTENT     what is being communicated   concepts | products | people
 *   BEHAVIOUR   what the field reads         form | trace | gather
 *   FORMATION   where the dots sit           contour | rings | burst | spiral
 *                                            | lattice | wave
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
   * Formation — the layout the dots are laid out on
   *
   * Behaviour says what the dots READ. Formation says where they SIT. Those
   * are genuinely separate questions, and collapsing them was the flaw in the
   * old "grid to form" slider: it asked how much the algorithm was allowed to
   * bend the rows, which is a question about the code and not about the work.
   *
   * Contour is the original answer — the picture decides the layout. The other
   * five decide it in advance, and the picture comes through them instead, as
   * dots that grow and crowd where the subject is near and shrink and thin
   * where it falls away. That is the right way round for a system that has to
   * stay recognisable across hundreds of different photographs: the formation
   * is the constant, the image is the variable.
   *
   * `radiates` marks the three built about a centre. They share the circle-to-
   * star axis and the focal point; the other two share an angle instead.
   * ------------------------------------------------------------------------*/
  var FORMATION = {
    contour:    { label: 'Contour',
                  hint: 'The picture decides the layout. Rows follow its own shape.' },
    concentric: { label: 'Rings', radiates: true,
                  hint: 'Rings out from a centre. The clearest read of circle to star.' },
    radial:     { label: 'Burst', radiates: true,
                  hint: 'Spokes out from a centre, doubling as they go so the density holds.' },
    spiral:     { label: 'Spiral', radiates: true,
                  hint: 'Arms turning out from a centre. One per point.' },
    grid:       { label: 'Lattice',
                  hint: 'Straight parallel rows at a set angle.' },
    wave:       { label: 'Wave',
                  hint: 'The same rows, travelling.' }
  };

  var FORMATION_ORDER = ['contour', 'concentric', 'radial', 'spiral', 'grid', 'wave'];

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
      formation: 'contour',
      content: 'concepts', behaviour: 'form', placement: 'none',
      intensity: 'hero', lead: 'density',
      params: { showPhoto: false, wipe: false, copySpace: 0.32, copyAngle: 270,
                starPoints: 5, converge: 0.75, fieldSource: 'generative' }
    },
    conceptQuiet: {
      label: 'Concept · Quiet',
      note: 'A sparse field or a cropped fragment, supporting type rather than competing with it.',
      formation: 'contour',
      content: 'concepts', behaviour: 'form', placement: 'none',
      intensity: 'quiet', lead: 'coverage',
      params: { showPhoto: false, wipe: false, copySpace: 0.5, copyAngle: 270,
                starPoints: 5, converge: 0.4, fieldSource: 'generative' }
    },
    peopleEnvironmental: {
      label: 'People · Environmental',
      note: 'Dots behind and around the person. The face is never touched.',
      formation: 'contour',
      content: 'people', behaviour: 'gather', placement: 'behind',
      intensity: 'supporting', lead: 'density',
      params: { showPhoto: true, wipe: false, protect: 0.55, copySpace: 0 }
    },
    peopleIntegrated: {
      label: 'People · Integrated',
      note: 'A controlled dissolve through clothing and the lower body, face left clear.',
      formation: 'contour',
      content: 'people', behaviour: 'form', placement: 'within',
      intensity: 'supporting', lead: 'coverage',
      params: { showPhoto: true, wipe: true, wipeAngle: 90, wipePosition: 0.55,
                wipeFeather: 0.3, protect: 0.7, copySpace: 0 }
    },
    productShowcase: {
      label: 'Product · Showcase',
      note: 'The object stays sharp and intact; the field supports it from behind.',
      formation: 'contour',
      content: 'products', behaviour: 'gather', placement: 'behind',
      intensity: 'supporting', lead: 'density',
      params: { showPhoto: true, wipe: false, protect: 0, copySpace: 0.2, copyAngle: 0 }
    },
    productDetail: {
      label: 'Product · Detail',
      note: 'A localised contour along one meaningful edge, opening into the background.',
      formation: 'contour',
      content: 'products', behaviour: 'trace', placement: 'around',
      intensity: 'quiet', lead: 'coverage',
      params: { showPhoto: true, wipe: true, wipeAngle: 0, wipePosition: 0.45,
                wipeFeather: 0.25, protect: 0, copySpace: 0 }
    }
  };

  /* --------------------------------------------------------------------------
   * The dot patterns
   *
   * The same machinery, pointed at a different question. An art direction
   * preset starts from what is being communicated and lets the picture decide
   * the layout. A dot pattern starts from a layout that has already been
   * decided, and something else comes through it.
   *
   * TWELVE ABSTRACT FORMATIONS. Each is a keyword given a shape — emergence,
   * ingenuity, progress and the rest — built as a height field in abstract.js
   * and read by the dots exactly as a depth map would be. There is no
   * photograph in any of them; the formation IS the image. Relief is off in
   * every one: a displacement that reads as bulge on a contour reads as a
   * wobble on a ring, and a wobbly ring is a mistake rather than a form.
   *
   * The carrier formation is chosen to agree with the field rather than argue
   * with it — rings for the fields built about a centre, spokes for the one
   * that gathers inwards, rows for the ones that travel. Only Ingenuity gives
   * its carrier any star at all, because there the four points ARE the idea
   * and the rings reinforce them; everywhere else the field speaks alone.
   *
   * TWO IMAGE PATTERNS. The other half of the same idea: a formation decided
   * in advance, with a photograph coming through it as dots that grow and
   * crowd where the subject is near. No photograph is drawn — the dots are
   * the only thing on the page, and the picture is legible from density.
   * ------------------------------------------------------------------------*/
  var PATTERN_PARAMS = {
    showPhoto: false, wipe: false, copySpace: 0, protect: 0,
    sizeDepth: 1, densityDepth: 1, colorDepth: 1, depthExaggeration: 0,
    starness: 0
  };

  function pattern(label, note, base, extra) {
    var p = { label: label, note: note, behaviour: 'form', placement: 'none',
              intensity: 'supporting', lead: 'density', params: {} };
    Object.keys(base).forEach(function (k) { p[k] = base[k]; });
    Object.keys(PATTERN_PARAMS).forEach(function (k) { p.params[k] = PATTERN_PARAMS[k]; });
    Object.keys(extra || {}).forEach(function (k) { p.params[k] = extra[k]; });
    return p;
  }

  /* keyword -> the carrier it is laid on, and any carrier setting it needs */
  var ABSTRACT_CARRIER = {
    emergence:      ['concentric', {}],
    ingenuity:      ['concentric', { starness: 0.35, starPoints: 4 }],
    progress:       ['grid',       { flowAngle: 0, rowAlign: 1 }],
    convergence:    ['concentric', {}],
    expansion:      ['concentric', {}],
    adaptation:     ['wave',       { flowAngle: 0 }],
    connection:     ['grid',       { flowAngle: 0, rowAlign: 1 }],
    collaboration:  ['concentric', {}],
    precision:      ['grid',       { flowAngle: 0, rowAlign: 1 }],
    transformation: ['grid',       { flowAngle: 90, rowAlign: 1 }],
    synergy:        ['concentric', {}],
    momentum:       ['wave',       { flowAngle: 0 }]
  };

  var ABSTRACT_KEYS = [];

  /* Built from abstract.js rather than restated here, so a formation cannot
   * exist in one file and be missing from the other. */
  if (CD.Abstract) {
    CD.Abstract.ORDER.forEach(function (name) {
      var m = CD.Abstract.META[name];
      var carrier = ABSTRACT_CARRIER[name] || ['concentric', {}];
      var extra = { fieldSource: 'abstract', abstractField: name };
      Object.keys(carrier[1]).forEach(function (k) { extra[k] = carrier[1][k]; });
      var key = 'abstract_' + name;
      PRESETS[key] = pattern(m.keyword + ' \u2014 ' + m.name, m.note,
        { content: 'concepts', formation: carrier[0] }, extra);
      ABSTRACT_KEYS.push(key);
    });
  }

  PRESETS.imageRings = pattern('Image \u00b7 Rings',
    'Concentric rings across the whole frame. The picture is the only reason ' +
    'they are not all identical: the dots grow and crowd where it is near.',
    { content: 'products', formation: 'concentric' },
    { focusX: 0.5, focusY: 0.5 });

  PRESETS.imageLattice = pattern('Image \u00b7 Lattice',
    'Straight rows, and the picture read off them as a halftone. The most ' +
    'neutral carrier there is, and the most legible.',
    { content: 'products', formation: 'grid' },
    { flowAngle: 0, rowAlign: 1 });

  /* Three families, kept apart in the list: they are answers to different
   * questions, and running twelve into six into two hides that. */
  var PRESET_GROUPS = [
    { label: 'Art direction',
      keys: ['conceptHero', 'conceptQuiet', 'peopleEnvironmental',
             'peopleIntegrated', 'productShowcase', 'productDetail'] },
    { label: 'Abstract formations', keys: ABSTRACT_KEYS },
    { label: 'Image through a formation', keys: ['imageRings', 'imageLattice'] }
  ];

  var PRESET_ORDER = PRESET_GROUPS.reduce(function (a, g) {
    return a.concat(g.keys);
  }, []);

  /* --------------------------------------------------------------------------
   * Palette
   *
   * Approved pairs rather than two free colour wells. A pair that has been
   * checked for contrast is a decision already made; a colour picker is that
   * decision handed back to whoever is in a hurry.
   * ------------------------------------------------------------------------*/
  /* Each entry is a list of stops read from far to near — the far end of the
   * surface first, so it can sit close to the background and let the form fade
   * out rather than end on a hard edge. One stop is a flat colour; two is the
   * tint the system has always had; three is a transition that passes THROUGH
   * a colour on its way, which is a different thing entirely and cannot be
   * faked by picking a pair.
   *
   * The three-stop set is the approved gradient. Its light variant runs the
   * stops the other way round on purpose: on bone, ice at the near end simply
   * disappears, and the whole point of the near end is that it is the part you
   * are meant to read. */
  var PALETTES = [
    { label: 'Red on black',   stops: ['#4a0410', '#ff2233'], bg: '#000000' },
    { label: 'Red on bone',    stops: ['#f0d9d4', '#e01b2d'], bg: '#f4efe9' },
    { label: 'Bone on red',    stops: ['#c4172a', '#f4efe9'], bg: '#d81026' },
    { label: 'Neutral',        stops: ['#3a352f', '#e8e2da'], bg: '#14120f' },
    { label: 'Signal',         stops: ['#de2027', '#687099', '#c5eef9'], bg: '#0c0e13' },
    { label: 'Signal on bone', stops: ['#c5eef9', '#687099', '#de2027'], bg: '#f4efe9' },
    { label: 'Red, flat',      stops: ['#de2027'], bg: '#f4efe9' },
    { label: 'Ice, flat',      stops: ['#c5eef9'], bg: '#0c0e13' }
  ];

  /* colorNear and colorFar are still written, because the joining strokes and
   * the exporter want one colour and one background rather than a ramp. */
  function applyPalette(params, index) {
    var p = PALETTES[clamp(index | 0, 0, PALETTES.length - 1)];
    params.colorStops = p.stops.slice();
    params.colorFar = p.stops[0];
    params.colorNear = p.stops[p.stops.length - 1];
    params.background = p.bg;
    return params;
  }

  /* The CSS gradient that shows what a palette is, for the swatch on the
   * button. A single stop has to be named twice or the browser refuses it. */
  function paletteCss(index) {
    var p = PALETTES[clamp(index | 0, 0, PALETTES.length - 1)];
    var s = p.stops.length > 1 ? p.stops : [p.stops[0], p.stops[0]];
    return 'linear-gradient(90deg,' + s.join(',') + ')';
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
     * measured; every other behaviour names its own source.
     *
     * This used to key off placement — whole-frame meant generated. That was
     * right while whole-frame only ever happened with no photograph, and wrong
     * the moment a formation covered the whole frame WITH one: a lattice laid
     * across a portrait must read the portrait, not a field invented in its
     * place. Content is what actually decides it, so content is what is
     * asked. For all six of the original presets this is the same answer. */
    out.fieldSource = choice.content === 'concepts' ? 'generative' : beh.field;

    applyIntensity(out, choice.intensity, choice.lead);

    var extra = choice.params || {};
    Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });

    /* what defines the choice is always written; the rest yields to the user */
    var DEFINING = { regionSource: 1, fieldSource: 1, formation: 1 };
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
    params.formation = preset.formation || 'contour';
    return compose(params, preset, keep);
  }

  CD.Art = {
    CONTENT: CONTENT, BEHAVIOUR: BEHAVIOUR, PLACEMENT: PLACEMENT,
    FORMATION: FORMATION, FORMATION_ORDER: FORMATION_ORDER,
    INTENSITY: INTENSITY, PRESETS: PRESETS, PRESET_ORDER: PRESET_ORDER,
    PRESET_GROUPS: PRESET_GROUPS, PALETTES: PALETTES,
    SIZE_MIN: SIZE_MIN, SIZE_MAX: SIZE_MAX,
    compose: compose, applyPreset: applyPreset,
    applyIntensity: applyIntensity, applyPalette: applyPalette,
    paletteCss: paletteCss
  };
})(CD);
