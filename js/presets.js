/* ============================================================================
 * presets.js — modes, and why there are only three of them.
 *
 * The obvious way to offer "interaction with imagery", "background to
 * imagery", "revealing imagery", "gridded versus fluid" and "with and without
 * imagery" is five modes. That is the wrong shape: they are not five points on
 * one axis, they are one axis and two switches.
 *
 *   MODE    which region of the picture gets dots
 *           full (all of it) | background (the ground only) | edge (the
 *           outline between them only)
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
    /* The whole frame becomes dots — subject and ground alike — with the
     * pattern varying across the light and the depth of everything in it. */
    full: {
      label: 'Full',
      hint: 'The whole picture becomes dots, varying with its light and depth.',
      params: {
        regionSource: 'all', fieldSource: 'image', edgeBand: 8,
        showPhoto: false, photoFade: 0, photoWipe: 0,
        wipe: false, wipePosition: 0.45, wipeAngle: 0, wipeFeather: 0.16,
        edgeDissolve: 0.5,
        dotSize: 2.0, dotSpacing: 3.6, lineSpacing: 6, lineDensity: 1,
        sizeVariation: 0.1, sizeFalloff: 1.35,
        randomness: 0.05, jitterAlong: 0.85, rowAlign: 0.3,
        flowStrength: 0.9, flowDistortion: 0.04, flowAngle: 0,
        depthExaggeration: 2, densityDepth: 1,
        sizeDepth: 1, colorDepth: 1, fadeDepth: 0
      }
    },

    /* The ground only. The subject is left alone as a photograph and the
     * pattern rings it, so depth is distance from the outline — which is what
     * makes the rings belong to the subject rather than halftone the wall. */
    background: {
      label: 'Background',
      hint: 'Only the ground is dotted. The subject is left untouched.',
      params: {
        regionSource: 'background', fieldSource: 'distance', edgeBand: 14,
        showPhoto: true, photoFade: 0, photoWipe: 0,
        wipe: false, wipePosition: 0.5, wipeAngle: 0, wipeFeather: 0.2,
        edgeDissolve: 0.2,
        dotSize: 2.4, dotSpacing: 5.5, lineSpacing: 9, lineDensity: 1,
        sizeVariation: 0.05, sizeFalloff: 1,
        randomness: 0.02, jitterAlong: 0.9, rowAlign: 0.8,
        flowStrength: 1, flowDistortion: 0, flowAngle: 0,
        depthExaggeration: 0, densityDepth: 0,
        sizeDepth: 0.25, colorDepth: 0.2, fadeDepth: 0
      }
    },

    /* Only the line where subject and ground meet, traced in dots. */
    edge: {
      label: 'Edge',
      hint: 'Only the outline where subject meets background.',
      params: {
        regionSource: 'edge', fieldSource: 'distance', edgeBand: 7,
        showPhoto: true, photoFade: 0, photoWipe: 0,
        wipe: false, wipePosition: 0.5, wipeAngle: 0, wipeFeather: 0.2,
        edgeDissolve: 0.75,
        dotSize: 2.2, dotSpacing: 4.4, lineSpacing: 5, lineDensity: 1.4,
        sizeVariation: 0.08, sizeFalloff: 1,
        randomness: 0.04, jitterAlong: 0.85, rowAlign: 0.5,
        flowStrength: 1, flowDistortion: 0, flowAngle: 0,
        depthExaggeration: 0, densityDepth: 0,
        sizeDepth: 0.35, colorDepth: 0.35, fadeDepth: 0
      }
    }
  };

  var ORDER = ['full', 'background', 'edge'];

  /* Write a mode's look parameters into `params`, leaving everything auto
   * owns exactly as it was — a mode decides where the dots go, the image
   * controls decide what the dots are reading. Returns the keys it touched. */
  function applyMode(params, name) {
    var mode = MODES[name] || MODES.full;
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
