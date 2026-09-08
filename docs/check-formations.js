/* ============================================================================
 * check-formations.js — do the twelve still mean what they say?
 *
 *     node docs/check-formations.js
 *
 * Each of the twelve abstract formations ships with a one-sentence visual
 * description, and a description is only worth having if something checks it.
 * Every assertion below is one clause of one of those sentences turned into a
 * measurement: the centre of Emergence must outrank its haze, the front of
 * Progress must fall off faster than its trail, the overlap in Collaboration
 * must be denser than either circle that makes it, Momentum must alternate AND
 * stay continuous.
 *
 * It exists because these fields are tuned by eye, and tuning by eye is how a
 * formation drifts away from the idea it was named for one small adjustment at
 * a time. Change a field, run this, and it will tell you which clause you just
 * stopped satisfying.
 * ==========================================================================*/
var fs = require('fs'), vm = require('vm'), path = require('path');
global.window = global;
['core.js', 'abstract.js'].forEach(function (f) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f });
});
var CD = global.CD;
var A = CD.Abstract;
var N = 257;                                  // square, so x and y both -1..1
function f(name) {
  var g = A.build(N, N, name, {});
  /* the builder frames each field by its own `fill`, so the inverse mapping
     back to the coordinates the functions are written in carries it too */
  var k = (A.META[name].fill || 1) / 2;
  return function (x, y) {           // x,y in field space -1..1
    var px = (x * k + 0.5) * N - 0.5, py = (y * k + 0.5) * N - 0.5;
    return g.sample(px, py, 0);
  };
}
var pass = 0, fail = 0;
function check(label, ok, detail) {
  (ok ? pass++ : fail++);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (detail ? '   ' + detail : ''));
}
function r(v) { return (+v).toFixed(3); }

var s;
console.log('Emergence — concentrated centre inside a faint diffuse field');
s = f('emergence');
check('centre is the peak', s(0,0) > 0.9, 'c=' + r(s(0,0)));
check('mid-field faint but present', s(0.5,0) > 0.05 && s(0.5,0) < 0.35, 'r0.5=' + r(s(0.5,0)));
check('fades out inside the frame', s(0.90,0.0) < 0.10, 'r0.90=' + r(s(0.90,0)));

console.log('Ingenuity — four soft points off a round centre');
s = f('ingenuity');
var pt = s(0.42,0), vl = s(0.42*0.707, 0.42*0.707);
check('point reaches further than valley', pt > vl * 2.5, 'point=' + r(pt) + ' valley=' + r(vl));
check('four-fold: all four axes equal', Math.abs(s(0.42,0)-s(0,0.42)) < 0.02 && Math.abs(s(-0.42,0)-s(0,-0.42)) < 0.02);
check('centre is a mass, not a hole', s(0,0) > 0.9, 'c=' + r(s(0,0)));

console.log('Progress — dense leading edge, tapering trail');
s = f('progress');
var head = 0.34;
check('front falls off faster than back',
      s(head+0.30, 0) < s(head-0.30, 0) * 0.55, 'front=' + r(s(head+0.3,0)) + ' back=' + r(s(head-0.3,0)));
check('densest at the head', s(head,0) > 0.92, 'head=' + r(s(head,0)));
check('trail still alive far behind', s(-0.55,0) > 0.08, 'tail=' + r(s(-0.55,0)));

console.log('Convergence — satellites gathering to a shared centre');
s = f('convergence');
var sat = s(Math.cos(0.35)*0.55, Math.sin(0.35)*0.55);
check('centre outranks every satellite', s(0,0) > sat, 'c=' + r(s(0,0)) + ' sat=' + r(sat));
check('satellite is a real peak', sat > 0.5, 'sat=' + r(sat));
var mid = s(Math.cos(0.35)*0.30, Math.sin(0.35)*0.30);
var offChannel = s(Math.cos(0.35+0.5)*0.30, Math.sin(0.35+0.5)*0.30);
check('channel is present but subtle', mid > offChannel * 1.15 && mid < 0.75,
      'channel=' + r(mid) + ' beside=' + r(offChannel));

console.log('Expansion — broad ring, open centre, dissolving edge');
s = f('expansion');
check('centre is open', s(0,0) < 0.15, 'c=' + r(s(0,0)));
check('ring is the peak', s(0.46,0) > 0.95, 'ring=' + r(s(0.46,0)));
check('dissolves outward', s(0.85,0) < s(0.46,0) * 0.35, 'outer=' + r(s(0.85,0)));

console.log('Adaptation — rises one way, dips the other, stays connected');
s = f('adaptation');
var a = 0.55, ca = Math.cos(a), sa = Math.sin(a);
var rise = s(0.5*ca, -0.5*sa), dip = s(0.5*sa, 0.5*ca);
check('rise clearly outranks dip', rise > dip * 3, 'rise=' + r(rise) + ' dip=' + r(dip));
check('never breaks: centre joins the two arms', s(0,0) > dip, 'c=' + r(s(0,0)));
check('contained, not a full-frame gradient', s(0.98*ca,-0.98*sa) < 0.3, 'far=' + r(s(0.98*ca,-0.98*sa)));

console.log('Connection — two masses, one narrow neck');
s = f('connection');
check('two equal masses', s(-0.46,0) > 0.95 && s(0.46,0) > 0.95);
check('neck is continuous', s(0,0) > 0.4, 'neck=' + r(s(0,0)));
check('neck is narrow', s(0,0.16) < s(0,0) * 0.5, 'off-neck=' + r(s(0,0.16)));

console.log('Collaboration — the overlap is denser than either field');
s = f('collaboration');
var lens = s(0,0), lobe = s(-0.55,0);
check('overlap outranks either disc alone', lens > lobe * 1.6, 'lens=' + r(lens) + ' disc=' + r(lobe));
check('both discs present', lobe > 0.25, 'disc=' + r(lobe));

console.log('Precision — flattened ellipse tightening to a central band');
s = f('precision');
check('wider than tall', s(0.75,0) > s(0,0.75) * 3, 'x=' + r(s(0.75,0)) + ' y=' + r(s(0,0.75)));
check('central band is tighter than the body', s(0,0.14) < s(0,0) * 0.62, 'band edge=' + r(s(0,0.14)));
check('edges graduate rather than cut', s(0,0.30) > 0.02 && s(0,0.30) < 0.3, 'edge=' + r(s(0,0.30)));

console.log('Transformation — two lobes turned differently, narrow midpoint');
s = f('transformation');
check('both lobes present', s(0,-0.42) > 0.9 && s(0,0.42) > 0.9);
check('waist is narrower than the lobes',
      s(0.26,0) < s(0.26,-0.42) * 0.5, 'waist=' + r(s(0.26,0)) + ' lobe=' + r(s(0.26,-0.42)));
check('but still joined', s(0,0) > 0.4, 'neck=' + r(s(0,0)));
var up = s(0.30*Math.cos(-0.55), -0.42 + 0.30*Math.sin(-0.55));
var dn = s(0.30*Math.cos(-0.55),  0.42 + 0.30*Math.sin(-0.55));
check('lobes point different ways', Math.abs(up - dn) > 0.2, 'up=' + r(up) + ' down=' + r(dn));

console.log('Synergy — distinct volumes, one whole');
s = f('synergy');
var l0 = s(Math.cos(-Math.PI/2)*0.40, Math.sin(-Math.PI/2)*0.40);
var between = s(Math.cos(-Math.PI/2 + Math.PI/3)*0.40, Math.sin(-Math.PI/2 + Math.PI/3)*0.40);
check('three equal lobes', l0 > 0.95);
check('lobes stay distinct', between < l0 * 0.75, 'between=' + r(between) + ' lobe=' + r(l0));
check('shared ground holds them together', between > 0.2, 'between=' + r(between));

console.log('Momentum — an oscillating ribbon with travelling concentrations');
s = f('momentum');
var crest = 0.26 * Math.sin(0.6 * 2.6);
check('ribbon follows its own centreline', s(0.6, crest) > s(0.6, 0) , 'on=' + r(s(0.6,crest)) + ' flat=' + r(s(0.6,0)));
var beats = [];
for (var x = -1; x <= 1; x += 0.02) beats.push(s(x, 0.26*Math.sin(x*2.6)));
var hi = Math.max.apply(null, beats), lo = Math.min.apply(null, beats);
/* Both halves of the description, because they pull against each other: the
   concentrations have to alternate, and the ribbon has to stay continuous
   while they do. A beat that reaches zero satisfies the first and breaks the
   second, and it renders as a row of separate blobs. */
check('concentrations alternate along it', hi > 0.9 && lo < 0.62, 'hi=' + r(hi) + ' lo=' + r(lo));
check('and it never breaks', lo > 0.25, 'lo=' + r(lo));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
