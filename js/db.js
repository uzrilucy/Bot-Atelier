// IndexedDB 래퍼 — botAtelierDB
const DB_NAME = 'botAtelierDB';
const VERSION = 1;
const STORES = ['projects', 'threads', 'artifacts', 'kv'];
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

async function run(store, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const db = {
  get: (s, id) => run(s, 'readonly', st => st.get(id)),
  all: (s) => run(s, 'readonly', st => st.getAll()),
  put: (s, v) => run(s, 'readwrite', st => st.put(v)),
  del: (s, id) => run(s, 'readwrite', st => st.delete(id)),
  clear: (s) => run(s, 'readwrite', st => st.clear()),
  async dump() {
    const out = {};
    for (const s of STORES) out[s] = await this.all(s);
    return out;
  },
  async restore(data) {
    for (const s of STORES) {
      if (!Array.isArray(data[s])) continue;
      await this.clear(s);
      for (const v of data[s]) await this.put(s, v);
    }
  }
};

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
