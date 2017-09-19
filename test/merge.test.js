'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var vclock = require('../shared/vclock');
var diff3 = require('../shared/diff3');
var notes = require('../shared/notes');

test('version vector comparison', function () {
  assert.equal(vclock.compare({ a: 1 }, { a: 1 }), 'equal');
  assert.equal(vclock.compare({ a: 1 }, { a: 2 }), 'before');
  assert.equal(vclock.compare({ a: 2, b: 1 }, { a: 2 }), 'after');
  assert.equal(vclock.compare({ a: 2 }, { b: 1 }), 'concurrent');
  assert.equal(vclock.compare({}, { a: 1 }), 'before');
  assert.deepEqual(vclock.merge({ a: 3, b: 1 }, { b: 4, c: 1 }), { a: 3, b: 4, c: 1 });
});

test('diff3 merges non-overlapping edits cleanly', function () {
  var base = 'shopping\n- milk\n- eggs\n- bread';
  var ours = 'shopping\n- oat milk\n- eggs\n- bread';
  var theirs = 'shopping\n- milk\n- eggs\n- bread\n- coffee';
  var r = diff3.merge3(base, ours, theirs);
  assert.equal(r.conflicts, 0);
  assert.equal(r.text, 'shopping\n- oat milk\n- eggs\n- bread\n- coffee');
});

test('diff3 takes identical changes once and flags real conflicts', function () {
  assert.equal(diff3.merge3('a\nb', 'a\nB', 'a\nB').text, 'a\nB');
  var r = diff3.merge3('title\nline', 'title\nmine', 'title\ntheirs');
  assert.equal(r.conflicts, 1);
  assert.equal(r.text, 'title\n<<<<<<< mine\nmine\n=======\ntheirs\n>>>>>>> theirs');
  assert.equal(diff3.merge3('', 'new', '').text, 'new');
  assert.equal(diff3.merge3('x', '', 'x').text, '', 'deleting all lines merges');
});

test('diff3 handles insertions at both ends and deletions', function () {
  var base = 'b\nc\nd';
  var r = diff3.merge3(base, 'a\nb\nc\nd', 'b\nd\ne');
  assert.equal(r.conflicts, 0);
  assert.equal(r.text, 'a\nb\nd\ne');
});

test('note merge: title, tags as sets, delete vs edit', function () {
  var base = { title: 'Trip', body: 'pack', tags: ['travel', 'todo'], deleted: false };
  var ours = { title: 'Trip to Austin', body: 'pack', tags: ['travel', 'todo', 'texas'], deleted: false };
  var theirs = { title: 'Trip', body: 'pack\nbook hotel', tags: ['travel'], deleted: false };
  var r = notes.mergeContent(base, ours, theirs);
  assert.equal(r.clean, true);
  assert.deepEqual(r.merged, { title: 'Trip to Austin', body: 'pack\nbook hotel', tags: ['texas', 'travel'], deleted: false });

  var titleClash = notes.mergeContent(base, Object.assign({}, base, { title: 'A' }), Object.assign({}, base, { title: 'B' }));
  assert.deepEqual(titleClash.conflicts, ['title']);

  var del = notes.mergeContent(base, Object.assign({}, base, { deleted: true }), base);
  assert.equal(del.merged.deleted, true, 'delete wins over an unchanged copy');
  var editBeatsDelete = notes.mergeContent(base, Object.assign({}, base, { deleted: true }), theirs);
  assert.equal(editBeatsDelete.merged.deleted, false, 'a concurrent edit resurrects the note');
});
