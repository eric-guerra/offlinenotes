import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Replica, httpRemote } from './replica';
import { IndexedDbStorage } from './storage';

let actor = localStorage.getItem('notes.actor');
if (!actor) {
  actor = crypto.randomUUID();
  localStorage.setItem('notes.actor', actor);
}
const replica = new Replica({ storage: new IndexedDbStorage(), actor, remote: httpRemote('') });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return online;
}

function ConflictPanel({ note, onResolve }) {
  const theirs = note.conflict.theirs;
  const [manual, setManual] = useState(null);
  return (
    <div className="conflict">
      <strong>This note was changed on another device.</strong> Conflicting: {note.conflict.fields.join(', ')}
      <div className="sides">
        <div><h4>Yours</h4><pre>{note.body}</pre></div>
        <div><h4>Theirs</h4><pre>{theirs.body}</pre></div>
      </div>
      {manual === null ? (
        <div className="row">
          <button onClick={() => onResolve({ ...note, conflict: null })}>Keep mine</button>
          <button onClick={() => onResolve(theirs)}>Keep theirs</button>
          <button onClick={() => setManual(`${note.body}\n\n---\n\n${theirs.body}`)}>Combine manually…</button>
        </div>
      ) : (
        <div>
          <textarea value={manual} onChange={(e) => setManual(e.target.value)} rows={10} />
          <button onClick={() => onResolve({ ...note, body: manual })}>Save combined</button>
        </div>
      )}
    </div>
  );
}

function App() {
  const [notes, setNotes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const online = useOnline();
  const saveTimer = useRef(null);

  const refresh = useCallback(async () => {
    setNotes(await replica.list());
    if (selectedId) setSelected(await replica.get(selectedId));
  }, [selectedId]);

  useEffect(() => {
    replica.onChange(refresh);
    refresh();
  }, [refresh]);

  const sync = useCallback(async () => {
    if (!navigator.onLine) return;
    try {
      const s = await replica.sync();
      setStatus(`Synced${s.merged ? ` · ${s.merged} merged` : ''}${s.conflicts ? ` · ${s.conflicts} need attention` : ''}`);
    } catch (e) {
      setStatus('Sync failed — will retry');
    }
  }, []);

  useEffect(() => {
    sync();
    const t = setInterval(sync, 15000);
    window.addEventListener('online', sync);
    return () => { clearInterval(t); window.removeEventListener('online', sync); };
  }, [sync]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes.filter((n) => !q || (n.title + ' ' + n.body + ' ' + n.tags.join(' ')).toLowerCase().includes(q));
  }, [notes, query]);

  const create = async () => {
    const note = await replica.edit(replica.newId(), { title: 'Untitled', body: '' });
    setSelectedId(note.id);
    setSelected(note);
  };

  // Debounced autosave: edits stay local and instant; sync picks them up.
  const change = (field, value) => {
    const next = { ...selected, [field]: value };
    setSelected(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      replica.edit(next.id, { title: next.title, body: next.body, tags: next.tags });
    }, 400);
  };

  return (
    <div className="app">
      <aside>
        <div className="row">
          <input placeholder="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button onClick={create}>New</button>
        </div>
        <p className={`net ${online ? 'on' : 'off'}`}>{online ? status || 'Online' : 'Offline — changes are saved on this device'}</p>
        <ul>
          {visible.map((n) => (
            <li key={n.id} className={n.id === selectedId ? 'active' : ''} onClick={() => { setSelectedId(n.id); setSelected(n); }}>
              <strong>{n.title || 'Untitled'}</strong>
              {n.conflict && <span className="badge">conflict</span>}
              {n.dirty && !n.conflict && <span className="dot" title="Not synced yet" />}
              <div className="muted">{n.body.slice(0, 60)}</div>
            </li>
          ))}
        </ul>
      </aside>
      <main>
        {selected ? (
          <>
            {selected.conflict && <ConflictPanel note={selected} onResolve={(c) => replica.resolve(selected.id, c).then(sync)} />}
            <input className="title" value={selected.title} onChange={(e) => change('title', e.target.value)} />
            <input className="tags" placeholder="tags, comma separated" value={selected.tags.join(', ')}
                   onChange={(e) => change('tags', e.target.value.split(','))} />
            <textarea className="body" value={selected.body} onChange={(e) => change('body', e.target.value)} />
            <button className="danger" onClick={() => replica.remove(selected.id).then(() => { setSelectedId(null); setSelected(null); })}>Delete</button>
          </>
        ) : <p className="muted">Select or create a note.</p>}
      </main>
    </div>
  );
}

ReactDOM.render(<App />, document.getElementById('root'));
