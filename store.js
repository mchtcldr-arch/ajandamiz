/* Veri katmanı. İki uygulama aynı arayüzü sunar:
 *   watch(col, cb, {latest})   koleksiyonu canlı dinle  → cb([{id, ...}])
 *   watchDoc(col, id, cb)      tek belgeyi canlı dinle   → cb({id, ...} | null)
 *   add / set / update / remove
 * Demo: localStorage (sekmeler arası senkron). Bulut: Firestore. */
window.CA_STORE = {
  local() {
    const P = 'cift-ajanda:';
    const mem = {};
    const listeners = {};
    const read = (col) => {
      try {
        const v = localStorage.getItem(P + col);
        if (v) {
          const o = JSON.parse(v);
          // ilk sürüm görevleri dizi olarak saklıyordu
          return Array.isArray(o) ? Object.fromEntries(o.map((t) => [t.id, t])) : o;
        }
      } catch { /* özel pencere vb. */ }
      return mem[col] || {};
    };
    const emit = (col) => (listeners[col] || []).forEach((f) => f());
    const write = (col, o) => {
      mem[col] = o;
      try { localStorage.setItem(P + col, JSON.stringify(o)); } catch { /* yok say */ }
      emit(col);
    };
    window.addEventListener('storage', (e) => { if (e.key && e.key.startsWith(P)) emit(e.key.slice(P.length)); });
    const on = (col, f) => {
      (listeners[col] = listeners[col] || []).push(f);
      f();
      return () => { listeners[col] = listeners[col].filter((x) => x !== f); };
    };
    const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    return {
      mode: 'demo',
      watch(col, cb, opts = {}) {
        return on(col, () => {
          let list = Object.entries(read(col)).map(([id, d]) => ({ ...d, id }))
            .sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0));
          if (opts.latest) list = list.slice(-opts.latest);
          cb(list);
        });
      },
      watchDoc(col, id, cb) { return on(col, () => { const d = read(col)[id]; cb(d ? { ...d, id } : null); }); },
      async add(col, data) {
        const id = uid(); const now = Date.now(); const o = read(col);
        o[id] = { ...data, createdAt: now, updatedAt: now };
        write(col, o);
        return id;
      },
      async set(col, id, data) {
        const o = read(col); const now = Date.now();
        o[id] = { ...data, createdAt: (o[id] && o[id].createdAt) || now, updatedAt: now };
        write(col, o);
      },
      async update(col, id, patch) {
        const o = read(col);
        if (!o[id]) throw new Error('Kayıt bulunamadı');
        o[id] = { ...o[id], ...patch, updatedAt: Date.now() };
        write(col, o);
      },
      async remove(col, id) { const o = read(col); delete o[id]; write(col, o); },
    };
  },

  firebase(db) {
    const FV = firebase.firestore.FieldValue;
    const list = (s) => s.docs.map((d) => ({ ...d.data({ serverTimestamps: 'estimate' }), id: d.id }));
    const onErr = (e) => { console.error(e); window.dispatchEvent(new CustomEvent('ca-error', { detail: e })); };
    return {
      mode: 'cloud',
      watch(col, cb, opts = {}) {
        const err = opts.silent ? (e) => console.warn(col, e.code || e) : onErr;
        if (opts.latest) {
          return db.collection(col).orderBy('createdAt', 'desc').limit(opts.latest)
            .onSnapshot((s) => cb(list(s).reverse()), err);
        }
        return db.collection(col).onSnapshot((s) => cb(list(s)), err);
      },
      watchDoc(col, id, cb) {
        return db.collection(col).doc(id).onSnapshot(
          (s) => cb(s.exists ? { ...s.data({ serverTimestamps: 'estimate' }), id: s.id } : null), onErr);
      },
      add: (col, data) => db.collection(col).add({ ...data, createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() }).then((r) => r.id),
      set: (col, id, data) => db.collection(col).doc(id).set({ ...data, updatedAt: FV.serverTimestamp() }),
      update: (col, id, patch) => db.collection(col).doc(id).update({ ...patch, updatedAt: FV.serverTimestamp() }),
      remove: (col, id) => db.collection(col).doc(id).delete(),
    };
  },
};
