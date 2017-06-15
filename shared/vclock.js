'use strict';

/**
 * Version vectors: { actorId: counter }. They capture causality, so we can tell whether one version
 * of a note descends from another (safe to fast-forward) or both were edited concurrently.
 */

function increment(vv, actor) {
  var next = Object.assign({}, vv);
  next[actor] = (next[actor] || 0) + 1;
  return next;
}

function merge(a, b) {
  var out = Object.assign({}, a);
  Object.keys(b || {}).forEach(function (k) {
    out[k] = Math.max(out[k] || 0, b[k]);
  });
  return out;
}

function leq(a, b) {
  return Object.keys(a || {}).every(function (k) { return (a[k] || 0) <= ((b || {})[k] || 0); });
}

/** Returns 'equal' | 'before' (a happened before b) | 'after' | 'concurrent'. */
function compare(a, b) {
  var ab = leq(a, b);
  var ba = leq(b, a);
  if (ab && ba) return 'equal';
  if (ab) return 'before';
  if (ba) return 'after';
  return 'concurrent';
}

module.exports = { increment: increment, merge: merge, leq: leq, compare: compare };
