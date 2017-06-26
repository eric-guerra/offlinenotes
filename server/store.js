'use strict';

var fs = require('fs');
var path = require('path');
var notes = require('../shared/notes');
var vclock = require('../shared/vclock');

var SERVER_ACTOR = 'server';

/**
 * Server-side note store with a change feed. Every accepted write gets the next sequence number,
 * so clients pull "everything since seq N" and never miss an update.
 *
 * push() handles a client write:
 *   client version descends from ours  → accept (fast-forward)
 *   ours descends from the client's    → stale; ignore and let the client pull
 *   concurrent                         → three-way merge against the client's base; accept if clean,
 *                                        otherwise reject with our version so the user can resolve
 */
function NoteStore(file) {
  this.file = file || null;
  this.docs = new Map();
  this.seq = 0;
  if (this.file && fs.existsSync(this.file)) {
    var data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    this.seq = data.seq;
    data.docs.forEach(function (d) { this.docs.set(d.id, d); }, this);
  }
}

NoteStore.prototype.save = function () {
  if (!this.file) return;
  fs.mkdirSync(path.dirname(this.file), { recursive: true });
  var tmp = this.file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ seq: this.seq, docs: Array.from(this.docs.values()) }));
  fs.renameSync(tmp, this.file);
};

NoteStore.prototype._write = function (id, content, vv) {
  var doc = Object.assign({ id: id }, content, { vv: vv, seq: ++this.seq, updatedAt: new Date().toISOString() });
  this.docs.set(id, doc);
  return doc;
};

NoteStore.prototype.changes = function (since, limit) {
  var out = [];
  this.docs.forEach(function (d) { if (d.seq > since) out.push(d); });
  out.sort(function (a, b) { return a.seq - b.seq; });
  out = out.slice(0, limit || 500);
  return { changes: out, lastSeq: out.length ? out[out.length - 1].seq : since, hasMore: out.length === (limit || 500) };
};

NoteStore.prototype.push = function (write) {
  var current = this.docs.get(write.id);
  var incoming = notes.contentOf(write);
  if (!current) return { status: 'accepted', doc: this._write(write.id, incoming, write.vv) };

  var order = vclock.compare(write.vv, current.vv);
  if (order === 'equal' || order === 'before') return { status: 'stale', doc: current };
  if (order === 'after') return { status: 'accepted', doc: this._write(write.id, incoming, write.vv) };

  var result = notes.mergeContent(write.base && notes.contentOf(write.base), incoming, notes.contentOf(current));
  if (result.clean) {
    var vv = vclock.increment(vclock.merge(write.vv, current.vv), SERVER_ACTOR);
    return { status: 'merged', doc: this._write(write.id, result.merged, vv) };
  }
  return { status: 'conflict', doc: current, conflicts: result.conflicts };
};

module.exports = NoteStore;
