'use strict';

/**
 * Line-based three-way merge (the algorithm behind `diff3`/`git merge`).
 *
 * Given a common ancestor O and two descendants A and B, regions where only one side changed are
 * taken from that side; regions changed identically on both sides are taken once; regions changed
 * differently on both sides are conflicts.
 */

/** For each line of `o`, the index of the matching line in `x` under a longest common subsequence, or -1. */
function lcsMap(o, x) {
  var n = o.length, m = x.length;
  // dp[i][j] = LCS length of o[i..] and x[j..]; rows as typed arrays for speed.
  var dp = new Array(n + 1);
  for (var i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
  for (i = n - 1; i >= 0; i--) {
    for (var j = m - 1; j >= 0; j--) {
      dp[i][j] = o[i] === x[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  var map = new Array(n).fill(-1);
  i = 0; j = 0;
  while (i < n && j < m) {
    if (o[i] === x[j]) { map[i] = j; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return map;
}

function same(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Merges lists of lines. Returns { lines, conflicts, chunks } where conflict chunks are
 * { conflict: true, ours, base, theirs } and clean chunks are { conflict: false, lines }.
 */
function mergeLines(o, a, b) {
  var ma = lcsMap(o, a);
  var mb = lcsMap(o, b);
  var chunks = [];
  var io = 0, ia = 0, ib = 0;
  function pushClean(lines) {
    if (!lines.length) return;
    var last = chunks[chunks.length - 1];
    if (last && !last.conflict) last.lines = last.lines.concat(lines);
    else chunks.push({ conflict: false, lines: lines.slice() });
  }
  for (;;) {
    // Next "stable" ancestor line: present, in order, in both descendants.
    var n = io;
    while (n < o.length && !(ma[n] >= ia && mb[n] >= ib)) n++;
    var oEnd = n, aEnd = n < o.length ? ma[n] : a.length, bEnd = n < o.length ? mb[n] : b.length;
    var oc = o.slice(io, oEnd), ac = a.slice(ia, aEnd), bc = b.slice(ib, bEnd);
    if (same(ac, oc)) pushClean(bc);
    else if (same(bc, oc) || same(ac, bc)) pushClean(ac);
    else chunks.push({ conflict: true, ours: ac, base: oc, theirs: bc });
    if (n >= o.length) break;
    pushClean([o[n]]);
    io = n + 1; ia = ma[n] + 1; ib = mb[n] + 1;
  }
  var lines = [];
  var conflicts = 0;
  chunks.forEach(function (c) {
    if (!c.conflict) { lines = lines.concat(c.lines); return; }
    conflicts++;
    lines = lines.concat(['<<<<<<< mine'], c.ours, ['======='], c.theirs, ['>>>>>>> theirs']);
  });
  return { lines: lines, conflicts: conflicts, chunks: chunks };
}

function splitLines(text) {
  return text === '' ? [] : String(text).split('\n');
}

/** Merges whole strings line by line. */
function merge3(base, ours, theirs) {
  var r = mergeLines(splitLines(base), splitLines(ours), splitLines(theirs));
  return { text: r.lines.join('\n'), conflicts: r.conflicts, chunks: r.chunks };
}

module.exports = { merge3: merge3, mergeLines: mergeLines, lcsMap: lcsMap };
