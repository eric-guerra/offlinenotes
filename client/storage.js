'use strict';

/**
 * Local persistence. Both adapters expose the same async API:
 *   getAll() get(id) put(doc) getMeta(key) setMeta(key, value)
 * The browser uses IndexedDB (survives reloads, works offline); tests use the memory adapter.
 */

function MemoryStorage() {
  this.docs = new Map();
  this.meta = new Map();
}
MemoryStorage.prototype.getAll = async function () { return Array.from(this.docs.values()).map(clone); };
MemoryStorage.prototype.get = async function (id) { return clone(this.docs.get(id)) || null; };
MemoryStorage.prototype.put = async function (doc) { this.docs.set(doc.id, clone(doc)); };
MemoryStorage.prototype.getMeta = async function (k) { return this.meta.has(k) ? this.meta.get(k) : null; };
MemoryStorage.prototype.setMeta = async function (k, v) { this.meta.set(k, v); };

function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }

function IndexedDbStorage(name) {
  this.ready = new Promise(function (resolve, reject) {
    var req = indexedDB.open(name || 'offline-notes', 1);
    req.onupgradeneeded = function () {
      var db = req.result;
      db.createObjectStore('notes', { keyPath: 'id' });
      db.createObjectStore('meta');
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}

/** Runs one request in a transaction and resolves with its result once the transaction commits. */
function run(storage, store, mode, op) {
  return storage.ready.then(function (db) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(store, mode);
      var req = op(t.objectStore(store));
      t.oncomplete = function () { resolve(req ? req.result : undefined); };
      t.onerror = function () { reject(t.error); };
      t.onabort = function () { reject(t.error); };
    });
  });
}

IndexedDbStorage.prototype.getAll = function () { return run(this, 'notes', 'readonly', function (s) { return s.getAll(); }); };
IndexedDbStorage.prototype.get = function (id) { return run(this, 'notes', 'readonly', function (s) { return s.get(id); }).then(function (d) { return d || null; }); };
IndexedDbStorage.prototype.put = function (doc) { return run(this, 'notes', 'readwrite', function (s) { return s.put(doc); }).then(function () {}); };
IndexedDbStorage.prototype.getMeta = function (k) { return run(this, 'meta', 'readonly', function (s) { return s.get(k); }).then(function (v) { return v === undefined ? null : v; }); };
IndexedDbStorage.prototype.setMeta = function (k, v) { return run(this, 'meta', 'readwrite', function (s) { return s.put(v, k); }).then(function () {}); };

module.exports = { MemoryStorage: MemoryStorage, IndexedDbStorage: IndexedDbStorage };
