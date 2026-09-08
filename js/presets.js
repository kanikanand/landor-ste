/* ============================================================================
 * presets.js — modes, and why there are only three of them.
 *
 * The obvious way to offer "interaction with imagery", "background to
 * imagery", "revealing imagery", "gridded versus fluid" and "with and without
 * imagery" is five modes. That is the wrong shape: they are not five points on
 * one axis, they are one axis and two switches.
 *
 *   MODE    where the dots live relative to the subject
 *           surface | fingerprint | interaction
 *
 *   PHOTO   whether the photograph is there at all
 *           on | off,  plus Reveal for the hand-over between the two
 *
 * There is deliberately no grid mode. A separate lattice fill was a fourth
 * thing to learn that produced a stiffer result than simply turning the
 * pattern's Grid-to-form slider down, which straightens the rows while still
 * knowing where the subject is. One slider replaced a mode.
 *
 * A preset only ever writes LOOK parameters. Image parameters — polarity,
 * thresholds, contrast, smoothing — belong to auto.js, which reads them off
 * the picture. The two sets are disjoint, so switching mode never undoes the
 * calibration and reloading an image never undoes the mode.
 * ==========================================================================*/
var CD = window.CD || {};

(function (CD) {
  'use strict';

  /* Values a preset is allowed to set. Anything absent from this list is
   * either auto's (see Auto.OWNED) or the user's alone. */
  var OWNED = [
    'regionSource', 'edgeBand', 'fieldSource',
    'showPhoto', 'photoFade', 'photoWipe', 'wipe', 'wipePosition',
    'wipeAngle', 'wipeFeather', 'edgeDissolve',
    'dotSize', 'dotSpacing', 'lineSpacing', 'lineDensity', 'sizeVariation',
    'sizeFalloff', 'randomness', 'jitterAlong', 'rowAlign', 'flowStrength',
    'flowDistortion', 'flowAngle', 'depthExaggeration', 'densityDepth',
    'sizeDepth', 'colorDepth', 'fadeDepth', 'shapeType'
  ];

  var MODES = {
    /* Dots on the subject: the halftone treatments, where the form itself is
     * drawn out of dots and the picture hands over to them. */
    surface: {
      label: 'Surface',
      hint: 'Dots on the subject. The form is drawn out of the picture.',
      params: {
        regionSource: 'subject', fieldSource: 'image', edgeBand: 12,
        showPhoto: true, photoFade: 0, photoWipe: 0.9,
        wipe: true, wipePosition: 0.45, wipeAngle: 0, wipeFeather: 0.16,
        edgeDissolve: 0.85,
        dotSize: 2.0, dotSpacing: 4.0, lineSpacing: 7, lineDensity: 1,
        sizeVariation: 0.12, sizeFalloff: 1.35,
        randomness: 0.06, jitterAlong: 0.85, rowAlign: 0.35,
        flowStrength: 0.9, flowDistortion: 0.04, flowAngle: 0,
        depthExaggeration: 2, densityDepth: 0.35,
        sizeDepth: 0.7, colorDepth: 1, fadeDepth: 0
      }
    },

    /* Dots as the ground the subject sits on. The photograph is left alone
     * and the pattern rings it, so depth comes from distance to the outline
     * rather than from the picture's tones — that is what makes the rings
     * read as offsets of the subject instead of as a halftone of the wall. */
    fingerprint: {
      label: 'Fingerprint',
      hint: 'Dots as the ground. The subject stays a photograph; the pattern rings it.',
      params: {
        regionSource: 'background', fieldSource: 'distance', edgeBand: 12,
        showPhoto: true, photoFade: 0, photoWipe: 0,
        wipe: false, wipePosition: 0.5, wipeAngle: 0, wipeFeather: 0.2,
        edgeDissolve: 0.35,
        dotSize: 2.4, dotSpacing: 5.5, lineSpacing: 9, lineDensity: 1,
        sizeVariation: 0.05, sizeFalloff: 1,
        randomness: 0.02, jitterAlong: 0.9, rowAlign: 0.8,
        flowStrength: 1, flowDistortion: 0, flowAngle: 0,
        depthExaggeration: 0, densityDepth: 0,
        sizeDepth: 0.25, colorDepth: 0.2, fadeDepth: 0
      }
    },

    /* A band straddling the outline, so the pattern and the subject
     * interlock rather than one being laid inside the other. */
    interaction: {
      label: 'Interaction',
      hint: 'A band across the outline, so pattern and subject interlock.',
      params: {
        regionSource: 'edge', fieldSource: 'distance', edgeBand: 18,
        showPhoto: true, photoFade: 0, photoWipe: 0,
        wipe: false, wipePosition: 0.5, wipeAngle: 0, wipeFeather: 0.2,
        edgeDissolve: 0.9,
        dotSize: 2.2, dotSpacing: 4.6, lineSpacing: 7, lineDensity: 1.2,
        sizeVariation: 0.1, sizeFalloff: 1.1,
        randomness: 0.05, jitterAlong: 0.85, rowAlign: 0.6,
        flowStrength: 1, flowDistortion: 0.03, flowAngle: 0,
        depthExaggeration: 0, densityDepth: 0.2,
        sizeDepth: 0.5, colorDepth: 0.5, fadeDepth: 0
      }
    }
  };

  var ORDER = ['surface', 'fingerprint', 'interaction'];

  /* Write a mode's look parameters into `params`, leaving everything auto
   * owns exactly as it was — a mode decides where the dots go, the image
   * controls decide what the dots are reading. Returns the keys it touched. */
  function applyMode(params, name) {
    var mode = MODES[name] || MODES.surface;
    var touched = [];
    Object.keys(mode.params).forEach(function (k) {
      if (OWNED.indexOf(k) === -1) return;      // never write outside the set
      params[k] = mode.params[k];
      touched.push(k);
    });
    return touched;
  }

  CD.Presets = {
    MODES: MODES, ORDER: ORDER, OWNED: OWNED, applyMode: applyMode
  };
})(CD);
