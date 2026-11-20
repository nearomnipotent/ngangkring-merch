// Data layer. Two backends with the same interface:
//  - Firebase Firestore: real-time, shared by everyone who opens the page.
//  - Demo: localStorage in this browser only (used until config.js is filled in).
//
// Firestore layout (all under events/{EVENT_ID}/):
//   stock/{itemId}     { design, warna, order, sizes:{s..xxxl}, taken:{po,bundling,ots} }
//   log/{auto}         { at, by, itemId, itemName, size, qty, channel, buyer, cancelled, cancelledBy, cancelledAt }
//   preorders/{id}     { no, name, product, size, qty, category, picked, pickedBy, pickedAt }

import { FIREBASE_CONFIG, EVENT_ID, INITIAL_STOCK, SIZES, CHANNELS } from './config.js';

const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';

export class UserError extends Error {}

const sizeLabel = (id) => SIZES.find((s) => s.id === id)?.label ?? id;

function seedItem(item, order) {
  return {
    design: item.design,
    warna: item.warna,
    order,
    sizes: { ...item.sizes },
    taken: Object.fromEntries(CHANNELS.map((c) => [c.id, 0]))
  };
}

// --- Shared rules: the same checks run in both backends ------------------

function applyRecord(item, { size, channel, qty }) {
  const left = item.sizes[size] ?? 0;
  if (!Number.isInteger(qty) || qty < 1) throw new UserError('Jumlah minimal 1.');
  if (qty > left) throw new UserError(`Stok ${sizeLabel(size)} tinggal ${left}.`);
  return {
    [`sizes.${size}`]: left - qty,
    [`taken.${channel}`]: (item.taken?.[channel] ?? 0) + qty
  };
}

function applyCancel(item, entry) {
  return {
    [`sizes.${entry.size}`]: (item.sizes[entry.size] ?? 0) + entry.qty,
    [`taken.${entry.channel}`]: Math.max(0, (item.taken?.[entry.channel] ?? 0) - entry.qty)
  };
}

function logEntry(item, itemId, { size, channel, qty, buyer, by }) {
  return {
    at: Date.now(),
    by,
    itemId,
    itemName: `${item.design} ${item.warna}`,
    size,
    qty,
    channel,
    buyer: buyer || '',
    cancelled: false
  };
}

// Apply {"sizes.xl": 3, ...} style patches to a plain object (demo backend).
function patch(obj, changes) {
  for (const [path, value] of Object.entries(changes)) {
    const keys = path.split('.');
    let o = obj;
    while (keys.length > 1) {
      const k = keys.shift();
      o = o[k] ??= {};
    }
    o[keys[0]] = value;
  }
}

// Parse rows copied from Google Sheets (tab-separated) or a CSV file.
// Expected columns: No | Nama | Jenis Produk | Ukuran | Jumlah | Kategori | (Sudah diambil?)
export function parsePreorders(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line.includes('\t')
      ? line.split('\t')
      : line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
    const [no, name, product, size, qty, category] = cells.map((c) => (c ?? '').trim());
    if (!/^\d+$/.test(no) || !product) continue; // skips headers and the TOTAL row
    rows.push({
      id: `po-${no}`,
      no: Number(no),
      name,
      product,
      size: size || '-',
      qty: Number(qty) || 1,
      category
    });
  }
  return rows;
}

// --- Demo backend (this browser only) -----------------------------------

function demoStore(emit) {
  const KEY = `merch-demo:${EVENT_ID}`;
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(KEY) : null;
  let state;

  const load = () => {
    try {
      state = JSON.parse(localStorage.getItem(KEY));
    } catch {
      state = null;
    }
    if (!state?.stock) {
      state = { stock: {}, log: [], preorders: {} };
      INITIAL_STOCK.forEach((it, i) => (state.stock[it.id] = seedItem(it, i)));
    }
  };
  const publish = () => {
    emit({
      stock: Object.entries(state.stock).map(([id, d]) => ({ id, ...d })),
      log: [...state.log].sort((a, b) => b.at - a.at),
      preorders: Object.entries(state.preorders).map(([id, d]) => ({ id, ...d }))
    });
  };
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch { /* storage full or blocked: keep working in memory */ }
    channel?.postMessage('changed');
    publish();
  };

  load();
  channel?.addEventListener('message', () => { load(); publish(); });
  queueMicrotask(publish);

  return {
    mode: 'demo',
    async record(op) {
      const item = state.stock[op.itemId];
      if (!item) throw new UserError('Item tidak ditemukan.');
      const changes = applyRecord(item, op);
      patch(item, changes);
      state.log.push({ id: crypto.randomUUID(), ...logEntry(item, op.itemId, op) });
      save();
    },
    async cancel(logId, by) {
      const entry = state.log.find((e) => e.id === logId);
      if (!entry || entry.cancelled) throw new UserError('Catatan ini sudah dibatalkan.');
      patch(state.stock[entry.itemId], applyCancel(state.stock[entry.itemId], entry));
      Object.assign(entry, { cancelled: true, cancelledBy: by, cancelledAt: Date.now() });
      save();
    },
    async setPicked(id, picked, by) {
      Object.assign(state.preorders[id], { picked, pickedBy: picked ? by : '', pickedAt: picked ? Date.now() : 0 });
      save();
    },
    async importPreorders(rows) {
      rows.forEach(({ id, ...data }) => (state.preorders[id] = { ...state.preorders[id], ...data }));
      save();
    }
  };
}

// --- Firebase backend (shared, real-time) --------------------------------

async function firebaseStore(emit, onStatus) {
  const [{ initializeApp }, { getAuth, signInAnonymously }, fs] = await Promise.all([
    import(FIREBASE_SDK + 'firebase-app.js'),
    import(FIREBASE_SDK + 'firebase-auth.js'),
    import(FIREBASE_SDK + 'firebase-firestore.js')
  ]);
  const app = initializeApp(FIREBASE_CONFIG);
  await signInAnonymously(getAuth(app));
  const db = fs.getFirestore(app);
  const ref = (...path) => fs.doc(db, 'events', EVENT_ID, ...path);
  const col = (name) => fs.collection(db, 'events', EVENT_ID, name);

  // First run: put the starting stock in. A transaction per item means two
  // people opening the page at the same moment cannot double-seed.
  const existing = await fs.getDocs(col('stock'));
  if (existing.empty) {
    await Promise.all(
      INITIAL_STOCK.map((it, i) =>
        fs.runTransaction(db, async (tx) => {
          const r = ref('stock', it.id);
          if (!(await tx.get(r)).exists()) tx.set(r, seedItem(it, i));
        })
      )
    );
  }

  const data = { stock: [], log: [], preorders: [] };
  const push = () => emit({ ...data });
  const fail = (err) => onStatus({ error: err });
  const live = (snap) => onStatus({ synced: !snap.metadata.fromCache });

  fs.onSnapshot(col('stock'), { includeMetadataChanges: true }, (snap) => {
    live(snap);
    data.stock = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    push();
  }, fail);
  fs.onSnapshot(fs.query(col('log'), fs.orderBy('at', 'desc'), fs.limit(1000)), (snap) => {
    data.log = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    push();
  }, fail);
  fs.onSnapshot(col('preorders'), (snap) => {
    data.preorders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    push();
  }, fail);

  return {
    mode: 'live',
    // Transactions: if two people take the last XL at the same moment,
    // only one succeeds and the other sees "Stok XL tinggal 0".
    record: (op) =>
      fs.runTransaction(db, async (tx) => {
        const r = ref('stock', op.itemId);
        const snap = await tx.get(r);
        if (!snap.exists()) throw new UserError('Item tidak ditemukan.');
        const item = snap.data();
        tx.update(r, applyRecord(item, op));
        tx.set(fs.doc(col('log')), logEntry(item, op.itemId, op));
      }),
    cancel: (logId, by) =>
      fs.runTransaction(db, async (tx) => {
        const lr = ref('log', logId);
        const entry = (await tx.get(lr)).data();
        if (!entry || entry.cancelled) throw new UserError('Catatan ini sudah dibatalkan.');
        const sr = ref('stock', entry.itemId);
        const item = (await tx.get(sr)).data();
        tx.update(sr, applyCancel(item, entry));
        tx.update(lr, { cancelled: true, cancelledBy: by, cancelledAt: Date.now() });
      }),
    setPicked: (id, picked, by) =>
      fs.updateDoc(ref('preorders', id), {
        picked,
        pickedBy: picked ? by : '',
        pickedAt: picked ? Date.now() : 0
      }),
    importPreorders: async (rows) => {
      const batch = fs.writeBatch(db);
      // merge keeps the "sudah diambil" ticks if the list is imported again
      rows.forEach(({ id, ...row }) => batch.set(ref('preorders', id), row, { merge: true }));
      await batch.commit();
    }
  };
}

export async function createStore(emit, onStatus) {
  if (!FIREBASE_CONFIG.projectId) return demoStore(emit);
  return firebaseStore(emit, onStatus);
}
