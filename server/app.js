'use strict';

var path = require('path');
var express = require('express');
var NoteStore = require('./store');

function createApp(options) {
  options = options || {};
  var store = options.store || new NoteStore(options.file);
  var app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/api/changes', function (req, res) {
    var since = Number(req.query.since || 0);
    if (!Number.isInteger(since) || since < 0) return res.status(400).json({ error: 'since must be a non-negative integer' });
    res.json(store.changes(since, Math.min(Number(req.query.limit) || 500, 500)));
  });

  /** Bulk push. Each result says whether the write was accepted, merged, stale or in conflict. */
  app.post('/api/push', function (req, res) {
    var docs = req.body && req.body.docs;
    if (!Array.isArray(docs) || docs.length > 200) return res.status(400).json({ error: 'docs must be an array of at most 200' });
    for (var i = 0; i < docs.length; i++) {
      var d = docs[i];
      if (!d || typeof d.id !== 'string' || !/^[\w-]{1,64}$/.test(d.id) || !d.vv || typeof d.vv !== 'object') {
        return res.status(422).json({ error: 'docs[' + i + '] needs an id and a version vector' });
      }
      if ((d.body || '').length > 200000 || (d.title || '').length > 300) return res.status(413).json({ error: 'docs[' + i + '] is too large' });
    }
    var results = docs.map(function (d) { return Object.assign({ id: d.id }, store.push(d)); });
    store.save();
    res.json({ results: results });
  });

  app.get('/healthz', function (req, res) { res.json({ ok: true, seq: store.seq }); });
  return { app: app, store: store };
}

module.exports = createApp;
