/* ============================================================================
 * dots.js — turning contour streamlines into oriented dots.
 *
 * Walks each line by arc length and emits a dot every `dotSpacing`
 * pixels, where the spacing and the size are read from the DEPTH field, and
 * the rotation is read from the FLOW field:
 *
 *     rotation = atan2(flow.y, flow.x)
 *
 * Depth exaggeration displaces each dot along the depth gradient (the surface
 * normal projected into the picture plane). That relief shift is what makes
 * the bands read as a form bulging towards the viewer rather than as a flat
 * contour map.
 * ==========================================================================*/
var CD = window.CD || {};

(function (CD) {
  'use strict';

  var clamp = CD.clamp, lerp = CD.lerp;

  /* Each dot: {x, y, s (radius in px), r (radians), d (depth 0..1)} */
  function buildDots(ctx) {
    var lines = ctx.lines;
    var depth = ctx.depth, grad = ctx.grad, mask = ctx.mask, flow = ctx.flow;
    var edge = ctx.edge;
    var s = ctx.fieldScale;
    var p = ctx.params;
    var rng = ctx.rng;

    /* Node + link: one shape lands every Nth step along the line, the other
     * fills the run between them. */
    var pairMode = p.shapeType === 'nodes';
    var nodeEvery = Math.max(2, Math.round(p.nodeEvery));
    var nodeScale = Math.max(0.1, p.nodeScale);

    var bandLimit = ctx.bandLimit || null;   // edge lines: tone gates the bands
    var valueField = ctx.valueField || depth; // what `d` means for this mode
    var toneField = ctx.toneField || depth;   // the picture's own tonality

    /* Coverage window on tonality: dots exist only where the picture falls
     * inside it. This is what puts marks on the hair and the shirt and
     * nowhere else, without touching the geometry that produced the lines. */
    var toneLo = Math.min(p.toneMin, p.toneMax);
    var toneHi = Math.max(p.toneMin, p.toneMax);
    var windowed = toneLo > 0.001 || toneHi < 0.999;
    var fillFrame = !!p.surfaceFillFrame;

    var dots = [];
    var jitter = p.randomness;
    var spacingBase = Math.max(0.6, p.dotSpacing);
    var maxDots = p.maxDots;

    /* Edge falloff works in view pixels; the distance field is in grid cells. */
    var edgeAmt = clamp(p.edgeFalloff, 0, 1);
    var edgeW = Math.max(0.001, p.edgeWidth) * s;

    for (var li = 0; li < lines.length && dots.length < maxDots; li++) {
      var line = lines[li];
      var pts = line.pts;
      var band = line.band || 0;
      if (!pts || pts.length < 4) continue;
      /* Edge lines are evenly spaced along the contour and gated by band;
       * surface streamlines take their spacing from tone and are gated by the
       * silhouette. Both kinds can be present in the same render. */
      var isEdge = line.kind === 'edge';
      var uniformSpacing = isEdge;

      /* Normally each line starts on a random phase so the dots do not comb
       * into rows. In node/link mode the phase is the rhythm, so every line
       * starts on a node instead — which also terminates open contours with
       * one rather than cutting off mid-run. */
      var carry = pairMode ? 0 : rng() * spacingBase;
      var idx = 0;                 // step count along this line
      var arc = 0;                 // arc length walked so far
      var segStart = 0;            // arc length at the start of this segment
      var lastNodeArc = -1e9;
      var lastNodeSize = 0;

      for (var i = 0; i < pts.length - 2; i += 2) {
        var ax = pts[i], ay = pts[i + 1];
        var bx = pts[i + 2], by = pts[i + 3];
        var segX = bx - ax, segY = by - ay;
        var segLen = Math.hypot(segX, segY);
        if (segLen < 1e-6) continue;
        var ux = segX / segLen, uy = segY / segLen;

        var t = carry;
        while (t < segLen) {
          arc = segStart + t;
          var x = ax + ux * t, y = ay + uy * t;
          var fx = x * s, fy = y * s;
          var m = mask.sample(fx, fy, 0);
          var d = valueField.sample(fx, fy, 0);

          /* Size against tone. Positive grows the dot towards the lights,
           * which is the halftone reading — big in the highlights, vanishing
           * in the shadows. Negative grows it towards the darks. At 0 the mark
           * is even, which is what an outline overlay wants. */
          var amt = clamp(p.sizeByTone, -1, 1);
          var ramp = amt >= 0 ? d : 1 - d;
          var toneScale = lerp(1, lerp(0.16, 1.0, ramp), Math.abs(amt));
          var base = p.dotSize * toneScale;
          var vary = 1 + (rng() - 0.5) * 2 * p.sizeVariation;
          var size = base * vary;

          /* Edge falloff: shrink towards the silhouette, independently of
           * depth. This is what stops the form ending on a hard rim and lets
           * it dissolve into the negative space instead. */
          if (edgeAmt > 0) {
            var ef = CD.smoothstep(0, edgeW, edge.sample(fx, fy, 0));
            size *= 1 - edgeAmt * (1 - ef);
          }

          /* Local spacing: dots crowd together where the surface faces the
           * viewer. Near dots are also the biggest, so the step is floored at
           * a little over one diameter — otherwise the densest, largest dots
           * fuse into a solid line and the halftone reads as fill. */
          var localSpacing = uniformSpacing ? spacingBase : spacingBase * lerp(1.5, 0.68, d);
          localSpacing *= 1 + (rng() - 0.5) * 2 * jitter * 0.6;
          /* The spacing floor uses the link size, before any node scaling: a
           * node is meant to sit proud of the run, not to push its neighbours
           * apart and break the rhythm. */
          localSpacing = Math.max(size * 2.15, localSpacing);

          var role = null;
          if (pairMode && p.shapeBy === 'tone') {
            /* Shape 1 takes the darks, shape 2 the lights. No rhythm: which
             * mark you get is a property of the picture at that point. */
            var sv = toneField.sample(fx, fy, 0);
            if (sv < p.shapeSplit) { role = 'node'; size *= nodeScale; }
            else { role = 'link'; }
          } else if (pairMode) {
            if (idx % nodeEvery === 0) {
              role = 'node';
              size *= nodeScale;
            } else {
              role = 'link';
              /* Keep clear of the node just placed, so it reads as a marked
               * point with the run starting after it rather than as a blob
               * with dots buried in its edge. */
              if (arc - lastNodeArc < (lastNodeSize + size) * 0.95) {
                idx++;
                t += localSpacing;
                continue;
              }
            }
          }

          /* In edge mode the contours deliberately run out into the
           * background, so the silhouette mask must not cull them; the tone
           * gate below decides what survives instead. */
          var alive = (isEdge && bandLimit)
            ? (band + 1 <= bandLimit(fx, fy))
            : (fillFrame || m > 0.5);

          if (alive && windowed) {
            var tv = toneField.sample(fx, fy, 0);
            if (tv < toneLo || tv > toneHi) alive = false;
          }

          if (alive && size > 0.16) {
            /* Rotation follows the contour. With a flow field that is the
             * field direction; on an extracted iso-line it is the line's own
             * tangent, which is the same thing measured directly. */
            var rot;
            if (flow) {
              var dir = CD.dirAt(flow, fx, fy);
              rot = Math.atan2(dir.y, dir.x);
            } else {
              rot = Math.atan2(uy, ux);
            }
            rot += (rng() - 0.5) * 2 * jitter * 0.9;

            /* relief displacement along the depth gradient */
            var px = x, py = y;
            if (p.depthExaggeration > 0.001) {
              var gx = grad.sample(fx, fy, 0), gy = grad.sample(fx, fy, 1);
              var gl = Math.hypot(gx, gy);
              if (gl > 1e-5) {
                var amt = p.depthExaggeration * Math.min(1, gl * 14);
                px += (gx / gl) * amt;
                py += (gy / gl) * amt;
              }
            }

            /* positional randomness, perpendicular to the contour so the
             * lines stay legible as lines */
            if (jitter > 0) {
              var jn = (rng() - 0.5) * 2 * jitter * localSpacing * 0.55;
              px += -uy * jn;
              py += ux * jn;
              var jt = (rng() - 0.5) * 2 * jitter * localSpacing * 0.35;
              px += ux * jt; py += uy * jt;
            }

            if (role === 'node') { lastNodeArc = arc; lastNodeSize = size; }
            dots.push({ x: px, y: py, s: size, r: rot, d: d, role: role });
            if (dots.length >= maxDots) break;
          }
          idx++;
          t += localSpacing;
        }
        carry = t - segLen;
        segStart += segLen;
      }
    }

    return dots;
  }

  CD.buildDots = buildDots;
})(CD);
