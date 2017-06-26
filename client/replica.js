'use strict';

var notes = require('../shared/notes');
var vclock = require('../shared/vclock');

/**
 * A local replica of the user's notes.
 *
 * Local doc shape:
 *   { id, title, body, tags, deleted, vv,
 *     base: { title, body, tags, deleted, vv },   // last version known to be on the server (merge ancestor)
 *     dirty: bool,                                // has local edits not yet accepted by the server
 *     conflict: null | { theirs: {...content, vv}, fields: [...] },
 *     updatedAt }
 *
 * Edits are applied locally first (works offline); sync() pulls the change feed, merges, then pushes.
 */
function Replica(options) {
  this.storage = options.storage;
  this.actor = options.actor;
  this.remote = options.remote; // { changes(since), push(docs) }
  this.listeners = [];
}

Replica.prototype.onChange = function (fn) {
  this.listeners.push(fn);
};

Replica.prototype._emit = function () {
  this.listeners.forEach(function (fn) { fn(); });
};

Replica.prototype.list = async function () {
  var all = await this.storage.getAll();
  return all.filter(function (d) { return !d.deleted; }).sort(function (a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
};

Replica.prototype.get = function (id) {
  return this.storage.get(id);
};

Replica.prototype.newId = function () {
  return this.actor.slice(0, 6) + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
};

/** Applies a local edit (create, update or delete). */
Replica.prototype.edit = async function (id, changes) {
  var doc = (await this.storage.get(id)) || { id: id, title: '', body: '', tags: [], deleted: false, vv: {}, base: null, dirty: false, conflict: null };
  var next = Object.assign({}, doc, changes, { vv: vclock.increment(doc.vv, this.actor), dirty: true, updatedAt: new Date().toISOString() });
  if (changes.tags) next.tags = changes.tags.map(function (t) { return t.trim().toLowerCase(); }).filter(Boolean);
  await this.storage.put(next);
  this._emit();
  return next;
};

Replica.prototype.remove = function (id) {
  return this.edit(id, { deleted: true });
};

/** Resolves a conflict with the user's chosen content; the result dominates both versions. */
Replica.prototype.resolve = async function (id, content) {
  var doc = await this.storage.get(id);
  if (!doc || !doc.conflict) throw new Error('no conflict on ' + id);
  var theirs = doc.conflict.theirs;
  var vv = vclock.increment(vclock.merge(doc.vv, theirs.vv), this.actor);
  var next = Object.assign({}, doc, notes.contentOf(content), { vv: vv, dirty: true, conflict: null, base: theirs, updatedAt: new Date().toISOString() });
  await this.storage.put(next);
  this._emit();
  return next;
};

/** Incorporates a server version into the local replica. */
Replica.prototype._integrate = async function (remote) {
  var local = await this.storage.get(remote.id);
  var remoteContent = Object.assign(notes.contentOf(remote), { vv: remote.vv });
  if (!local) {
    await this.storage.put(Object.assign({ id: remote.id }, remoteContent, { base: remoteContent, dirty: false, conflict: null, updatedAt: remote.updatedAt }));
    return 'added';
  }
  var order = vclock.compare(local.vv, remote.vv);
  if (order === 'equal') {
    if (local.dirty) { local.dirty = false; local.base = remoteContent; await this.storage.put(local); }
    return 'unchanged';
  }
  if (order === 'before') {
    // Remote strictly newer and we have nothing it doesn't: fast-forward.
    await this.storage.put(Object.assign({}, local, remoteContent, { base: remoteContent, dirty: false, conflict: null, updatedAt: remote.updatedAt }));
    return 'updated';
  }
  if (order === 'after') return 'local-newer';

  // Concurrent: try a three-way merge locally.
  var result = notes.mergeContent(local.base, notes.contentOf(local), notes.contentOf(remote));
  if (result.clean) {
    var vv = vclock.increment(vclock.merge(local.vv, remote.vv), this.actor);
    await this.storage.put(Object.assign({}, local, result.merged, { vv: vv, base: remoteContent, dirty: true, conflict: null, updatedAt: new Date().toISOString() }));
    return 'merged';
  }
  await this.storage.put(Object.assign({}, local, { conflict: { theirs: remoteContent, fields: result.conflicts } }));
  return 'conflict';
};

/** Pull then push. Returns a summary for the UI. */
Replica.prototype.sync = async function () {
  var summary = { pulled: 0, pushed: 0, merged: 0, conflicts: 0 };
  var since = (await this.storage.getMeta('checkpoint')) || 0;
  for (;;) {
    var feed = await this.remote.changes(since);
    for (var i = 0; i < feed.changes.length; i++) {
      var outcome = await this._integrate(feed.changes[i]);
      summary.pulled++;
      if (outcome === 'merged') summary.merged++;
      if (outcome === 'conflict') summary.conflicts++;
    }
    since = feed.lastSeq;
    await this.storage.setMeta('checkpoint', since);
    if (!feed.hasMore) break;
  }

  var all = await this.storage.getAll();
  var outgoing = all.filter(function (d) { return d.dirty && !d.conflict; });
  if (outgoing.length) {
    var response = await this.remote.push(outgoing.map(function (d) {
      return Object.assign({ id: d.id, vv: d.vv, base: d.base }, notes.contentOf(d));
    }));
    for (var j = 0; j < response.results.length; j++) {
      var r = response.results[j];
      var doc = await this.storage.get(r.id);
      if (r.status === 'accepted' || r.status === 'merged') {
        var serverContent = Object.assign(notes.contentOf(r.doc), { vv: r.doc.vv });
        // Only clear dirty if no newer local edit happened while the request was in flight.
        var stillCurrent = vclock.leq(doc.vv, r.doc.vv);
        await this.storage.put(Object.assign({}, doc, stillCurrent ? serverContent : {}, { base: serverContent, dirty: !stillCurrent }));
        summary.pushed++;
        if (r.status === 'merged') summary.merged++;
      } else if (r.status === 'conflict') {
        await this.storage.put(Object.assign({}, doc, { conflict: { theirs: Object.assign(notes.contentOf(r.doc), { vv: r.doc.vv }), fields: r.conflicts } }));
        summary.conflicts++;
      }
      // 'stale' means the server already has something newer; the next pull integrates it.
    }
  }
  this._emit();
  return summary;
};

/** HTTP remote for the browser (and for integration tests against the real server). */
function httpRemote(baseUrl, fetchImpl) {
  var f = fetchImpl || fetch;
  async function json(res) {
    if (!res.ok) throw new Error('sync failed: HTTP ' + res.status);
    return res.json();
  }
  return {
    changes: function (since) { return f(baseUrl + '/api/changes?since=' + since).then(json); },
    push: function (docs) {
      return f(baseUrl + '/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docs: docs }) }).then(json);
    }
  };
}

module.exports = { Replica: Replica, httpRemote: httpRemote };
