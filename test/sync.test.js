'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var createApp = require('../server/app');
var Replica = require('../client/replica').Replica;
var httpRemote = require('../client/replica').httpRemote;
var MemoryStorage = require('../client/storage').MemoryStorage;

function start(file) {
  return new Promise(function (resolve) {
    var created = createApp({ file: file });
    var server = created.app.listen(0, function () {
      var base = 'http://localhost:' + server.address().port;
      var offline = new Set();
      function device(name) {
        var remote = httpRemote(base, function (url, opts) {
          if (offline.has(name)) return Promise.reject(new Error('network down'));
          return fetch(url, opts);
        });
        return new Replica({ storage: new MemoryStorage(), actor: name, remote: remote });
      }
      resolve({
        store: created.store,
        device: device,
        goOffline: function (n) { offline.add(n); },
        goOnline: function (n) { offline.delete(n); },
        close: function () { return new Promise(function (r) { server.close(r); }); }
      });
    });
  });
}

async function body(replica, id) {
  return (await replica.get(id)).body;
}

test('notes created on one device appear on another', async function (t) {
  var env = await start();
  t.after(env.close);
  var laptop = env.device('laptop');
  var phone = env.device('phone');
  var n = await laptop.edit('n1', { title: 'Groceries', body: '- milk', tags: ['Home '] });
  assert.deepEqual(n.tags, ['home']);
  assert.deepEqual(await laptop.sync(), { pulled: 0, pushed: 1, merged: 0, conflicts: 0 });
  await phone.sync();
  var onPhone = await phone.get('n1');
  assert.equal(onPhone.title, 'Groceries');
  assert.equal(onPhone.dirty, false);
  assert.equal((await laptop.get('n1')).dirty, false);
});

test('concurrent offline edits to different lines merge automatically on both devices', async function (t) {
  var env = await start();
  t.after(env.close);
  var laptop = env.device('laptop');
  var phone = env.device('phone');
  await laptop.edit('n1', { title: 'List', body: 'milk\neggs\nbread' });
  await laptop.sync();
  await phone.sync();

  env.goOffline('phone');
  await laptop.edit('n1', { body: 'oat milk\neggs\nbread' });
  await phone.edit('n1', { body: 'milk\neggs\nbread\ncoffee' });
  await assert.rejects(phone.sync(), /network down/);
  await laptop.sync();

  env.goOnline('phone');
  var s = await phone.sync();
  assert.equal(s.merged, 1, 'phone merged the concurrent change locally');
  await laptop.sync();
  assert.equal(await body(phone, 'n1'), 'oat milk\neggs\nbread\ncoffee');
  assert.equal(await body(laptop, 'n1'), 'oat milk\neggs\nbread\ncoffee');
  assert.equal(env.store.docs.get('n1').body, 'oat milk\neggs\nbread\ncoffee');
});

test('conflicting edits surface for resolution and the resolution wins everywhere', async function (t) {
  var env = await start();
  t.after(env.close);
  var a = env.device('a');
  var b = env.device('b');
  await a.edit('n1', { title: 'Plan', body: 'meet at 5' });
  await a.sync();
  await b.sync();

  await a.edit('n1', { body: 'meet at 6' });
  await b.edit('n1', { body: 'meet at 7' });
  await a.sync();
  var s = await b.sync();
  assert.equal(s.conflicts, 1);
  var conflicted = await b.get('n1');
  assert.deepEqual(conflicted.conflict.fields, ['body']);
  assert.equal(conflicted.conflict.theirs.body, 'meet at 6');
  assert.equal(conflicted.body, 'meet at 7', 'local text is never silently overwritten');

  await b.resolve('n1', { title: 'Plan', body: 'meet at 6:30', tags: [] });
  await b.sync();
  await a.sync();
  assert.equal(await body(a, 'n1'), 'meet at 6:30');
  assert.equal((await b.get('n1')).conflict, null);
});

test('server-side merge when a stale client pushes without pulling first', async function (t) {
  var env = await start();
  t.after(env.close);
  var a = env.device('a');
  var b = env.device('b');
  await a.edit('n1', { title: 'T', body: 'one\ntwo\nthree' });
  await a.sync();
  await b.sync();
  await a.edit('n1', { body: 'ONE\ntwo\nthree' });
  await a.sync();
  // b pushes directly (simulating a client that skipped the pull)
  await b.edit('n1', { body: 'one\ntwo\nTHREE' });
  var doc = await b.get('n1');
  var result = env.store.push({ id: 'n1', vv: doc.vv, base: doc.base, title: doc.title, body: doc.body, tags: doc.tags });
  assert.equal(result.status, 'merged');
  assert.equal(result.doc.body, 'ONE\ntwo\nTHREE');
  assert.equal(result.doc.vv.server, 1);
});

test('deletes propagate; an edit concurrent with a delete keeps the note', async function (t) {
  var env = await start();
  t.after(env.close);
  var a = env.device('a');
  var b = env.device('b');
  await a.edit('n1', { title: 'Old', body: 'x' });
  await a.edit('n2', { title: 'Keep', body: 'y' });
  await a.sync();
  await b.sync();

  await a.remove('n1');
  await a.remove('n2');
  await b.edit('n2', { body: 'y, edited' });
  await a.sync();
  await b.sync();
  await a.sync();
  var titles = async function (r) { return (await r.list()).map(function (n) { return n.title; }); };
  assert.deepEqual(await titles(a), ['Keep']);
  assert.deepEqual(await titles(b), ['Keep']);
});

test('change feed pagination and persistence', async function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-'));
  var file = path.join(dir, 'notes.json');
  var env = await start(file);
  var a = env.device('a');
  for (var i = 0; i < 7; i++) await a.edit('n' + i, { title: 'Note ' + i, body: '' });
  await a.sync();
  var page = env.store.changes(0, 3);
  assert.equal(page.changes.length, 3);
  assert.equal(page.hasMore, true);
  await env.close();

  var env2 = await start(file);
  var b = env2.device('b');
  var s = await b.sync();
  assert.equal(s.pulled, 7);
  assert.equal((await b.list()).length, 7);
  await env2.close();
});
