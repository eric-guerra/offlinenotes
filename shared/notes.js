'use strict';

var vclock = require('./vclock');
var diff3 = require('./diff3');

/**
 * Note content is { title, body, tags, deleted }. Merging two concurrent versions uses their
 * common ancestor (`base`): body lines via diff3, title as a single value, tags as a set
 * (additions on either side kept, removals on either side honored), and deletion as "a delete
 * wins unless the other side edited".
 */

function contentOf(doc) {
  return { title: doc.title || '', body: doc.body || '', tags: (doc.tags || []).slice().sort(), deleted: !!doc.deleted };
}

function sameContent(a, b) {
  return a.title === b.title && a.body === b.body && a.deleted === b.deleted && a.tags.join('\u0000') === b.tags.join('\u0000');
}

function mergeValue(base, ours, theirs) {
  if (ours === theirs) return { value: ours, conflict: false };
  if (ours === base) return { value: theirs, conflict: false };
  if (theirs === base) return { value: ours, conflict: false };
  return { value: ours, conflict: true };
}

function mergeTags(base, ours, theirs) {
  var b = new Set(base), o = new Set(ours), t = new Set(theirs);
  var out = new Set();
  o.forEach(function (x) { out.add(x); });
  t.forEach(function (x) { out.add(x); });
  b.forEach(function (x) { if (!o.has(x) || !t.has(x)) out.delete(x); }); // removed by either side
  return Array.from(out).sort();
}

/**
 * Returns { merged, clean, conflicts: [field...] }. If not clean, `merged` contains our values for the
 * conflicting fields (body with conflict markers) so nothing is lost.
 */
function mergeContent(base, ours, theirs) {
  base = base || { title: '', body: '', tags: [], deleted: false };
  var conflicts = [];
  var title = mergeValue(base.title, ours.title, theirs.title);
  if (title.conflict) conflicts.push('title');
  var body = diff3.merge3(base.body, ours.body, theirs.body);
  if (body.conflicts) conflicts.push('body');
  var deleted;
  var edited = function (side) { return side.title !== base.title || side.body !== base.body || side.tags.join() !== base.tags.join(); };
  if (ours.deleted && theirs.deleted) deleted = true;
  else if (ours.deleted) deleted = !edited(theirs);   // edit beats a concurrent delete
  else if (theirs.deleted) deleted = !edited(ours);
  else deleted = false;
  return {
    merged: { title: title.value, body: body.text, tags: mergeTags(base.tags, ours.tags, theirs.tags), deleted: deleted },
    clean: conflicts.length === 0,
    conflicts: conflicts
  };
}

module.exports = { contentOf: contentOf, sameContent: sameContent, mergeContent: mergeContent, mergeTags: mergeTags, vclock: vclock };
