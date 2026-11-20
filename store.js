// Data layer. Two backends share ONE set of rules (the `ops` below):
//  - Firebase Firestore: real-time, shared by everyone who opens the page.
//  - Demo: localStorage in this browser only (used when config.js has no Firebase keys).
//
// Firestore layout (all under events/{EVENT_ID}/):
//   stock/{itemId}   { design, warna, type, order, sizes:{...}, taken:{po,bundling,ots} }
//   log/{auto}       sale:   { type:'sale', at, by, itemId, itemName, size, qty, channel, buyer,
//                              price, amount, stockTaken, poId, cancelled, cancelledBy, cancelledAt }
//                    adjust: { type:'adjust', at, by, itemId, itemName, note }
//   preorders/{id}   { no, name, product, size, qty, category, picked, pickedBy, pickedAt, logId }

import { FIREBASE_CONFIG, EVENT_ID, CATALOG, SIZES_BY_TYPE, CHANNELS, PRICES } from './config.js';

const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';

export class UserError extends Error {}

export const catalogItem = (id) => CATALOG.find((c) => c.id === id);
export const sizesFor = (type) => SIZES_BY_TYPE[type] ?? SIZES_BY_TYPE.kaos;
export const sizeLabel = (id) => Object.values(SIZES_BY_TYPE).flat().find((s) => s.id === id)?.label ?? id;
export const priceOf = (itemId) => PRICES[catalogItem(itemId)?.type] ?? PRICES.kaos;
const itemName = (it) => (it.type === 'totebag' ? it.design : `${it.design} ${it.warna}`);

function seedItem(item, order) {
  return {
    design: item.design,
    warna: item.warna,
    type: item.type,
    order,
    sizes: { ...item.sizes },
    taken: Object.fromEntries(CHANNELS.map((c) => [c.id, 0]))
  };
}

// Match a pre-order row ("Kaos Senang Lawan (Hitam)", "XL") to a catalogue item and size.
// Returns null parts when there is no clear match (the pickup is then still
// counted as money, but no stock is taken).
export function matchPreorder(product = '', size = '') {
  const p = product.toLowerCase();
  const sz = size.trim().toUpperCase();
  if (p.includes('totebag') || p.includes('tote bag')) return { itemId: 'totebag', size: 'one', type: 'totebag' };
  const light = /krem|cream|putih|white/.test(p);
  const dark = /hitam|black/.test(p);
  let itemId = null;
  if (p.includes('senang')) itemId = light ? 'senang-lawan_krem' : dark ? 'senang-lawan_hitam' : null;
  else if (p.includes('easy life') || p.includes('sansiro')) itemId = light ? 'sansiro_putih' : dark ? 'sansiro_hitam' : null;
  else if (p.includes('fisipol')) itemId = dark ? 'fisipol_hitam' : null;
  const sizeId = { S: 's', M: 'm', L: 'l', XL: 'xl', XXL: 'xxl', '2XL': 'xxl', XXXL: 'xxxl', '3XL': 'xxxl' }[sz] ?? null;
  return { itemId: itemId && sizeId ? itemId : null, size: sizeId, type: 'kaos' };
}

// --- The rules. `t` is a transaction: get / set / update / newId -----------

const ops = {
  async record(t, { itemId, size, channel, qty, buyer, by }) {
    const item = await t.get(['stock', itemId]);
    if (!item) throw new UserError('Item tidak ditemukan.');
    const left = item.sizes?.[size] ?? 0;
    if (!Number.isInteger(qty) || qty < 1) throw new UserError('Jumlah minimal 1.');
    if (qty > left) throw new UserError(`Stok ${sizeLabel(size)} tinggal ${left}.`);
    const price = priceOf(itemId);
    t.update(['stock', itemId], {
      [`sizes.${size}`]: left - qty,
      [`taken.${channel}`]: (item.taken?.[channel] ?? 0) + qty
    });
    t.set(['log', t.newId('log')], {
      type: 'sale', at: Date.now(), by, itemId, itemName: itemName(item), size, qty, channel,
      buyer: buyer || '', price, amount: price * qty, stockTaken: true, poId: '', cancelled: false
    });
  },

  async cancel(t, logId, by) {
    const entry = await t.get(['log', logId]);
    if (!entry || entry.type === 'adjust' || entry.cancelled) throw new UserError('Catatan ini sudah dibatalkan.');
    const item = entry.stockTaken && entry.itemId ? await t.get(['stock', entry.itemId]) : null;
    const po = entry.poId ? await t.get(['preorders', entry.poId]) : null;
    if (item) {
      t.update(['stock', entry.itemId], {
        [`sizes.${entry.size}`]: (item.sizes?.[entry.size] ?? 0) + entry.qty,
        [`taken.${entry.channel}`]: Math.max(0, (item.taken?.[entry.channel] ?? 0) - entry.qty)
      });
    }
    if (po && po.logId === logId) t.update(['preorders', entry.poId], { picked: false, pickedBy: '', pickedAt: 0, logId: '' });
    t.update(['log', logId], { cancelled: true, cancelledBy: by, cancelledAt: Date.now() });
  },

  // A pre-order is collected: tick it, take the matching shirt off the stock
  // (when there is a clear match and one left) and count its money.
  async pickPreorder(t, poId, by) {
    const po = await t.get(['preorders', poId]);
    if (!po) throw new UserError('Pemesan tidak ditemukan.');
    if (po.picked) throw new UserError('Sudah ditandai diambil.');
    const m = matchPreorder(po.product, po.size);
    const item = m.itemId ? await t.get(['stock', m.itemId]) : null;
    const qty = Number(po.qty) || 1;
    const left = item?.sizes?.[m.size] ?? 0;
    const stockTaken = !!item && left >= qty;
    const price = PRICES[m.type] ?? PRICES.kaos;
    if (stockTaken) {
      t.update(['stock', m.itemId], {
        [`sizes.${m.size}`]: left - qty,
        'taken.po': (item.taken?.po ?? 0) + qty
      });
    }
    const logId = t.newId('log');
    t.set(['log', logId], {
      type: 'sale', at: Date.now(), by, itemId: m.itemId ?? '', itemName: po.product,
      size: m.size ?? po.size, qty, channel: 'po', buyer: po.name || `Pre-order no. ${po.no}`,
      price, amount: price * qty, stockTaken, poId, cancelled: false
    });
    t.update(['preorders', poId], { picked: true, pickedBy: by, pickedAt: Date.now(), logId });
    return { stockTaken, matched: !!m.itemId };
  },

  async setStock(t, itemId, sizes, by) {
    const item = await t.get(['stock', itemId]);
    if (!item) throw new UserError('Item tidak ditemukan.');
    const changes = {};
    const notes = [];
    for (const s of sizesFor(item.type)) {
      const next = sizes[s.id];
      if (!Number.isInteger(next) || next < 0) throw new UserError(`Angka stok ${s.label} tidak valid.`);
      const prev = item.sizes?.[s.id] ?? 0;
      if (next !== prev) {
        changes[`sizes.${s.id}`] = next;
        notes.push(`${s.label} ${prev}→${next}`);
      }
    }
    if (!notes.length) return false;
    t.update(['stock', itemId], changes);
    t.set(['log', t.newId('log')], { type: 'adjust', at: Date.now(), by, itemId, itemName: itemName(item), note: notes.join(', ') });
    return true;
  }
};

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
    rows.push({ id: `po-${no}`, no: Number(no), name, product, size: size || '-', qty: Number(qty) || 1, category });
  }
  return rows;
}

// --- Demo backend (this browser only) -----------------------------------

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

function demoStore(emit) {
  const KEY = `merch-demo-v2:${EVENT_ID}`;
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(KEY) : null;
  let state;

  const load = () => {
    try { state = JSON.parse(localStorage.getItem(KEY)); } catch { state = null; }
    state ??= { stock: {}, log: {}, preorders: {} };
    CATALOG.forEach((it, i) => { state.stock[it.id] ??= seedItem(it, i); });
  };
  const list = (col) => Object.entries(state[col]).map(([id, d]) => ({ id, ...d }));
  const publish = () => emit({
    stock: list('stock'),
    log: list('log').sort((a, b) => b.at - a.at),
    preorders: list('preorders')
  });
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* blocked: keep in memory */ }
    channel?.postMessage('changed');
    publish();
  };
  const run = async (fn) => {
    const draft = structuredClone(state);
    const t = {
      get: async ([col, id]) => (draft[col][id] ? structuredClone(draft[col][id]) : null),
      set: ([col, id], d) => { draft[col][id] = structuredClone(d); },
      update: ([col, id], c) => patch(draft[col][id], c),
      newId: () => crypto.randomUUID()
    };
    const result = await fn(t);
    state = draft;
    save();
    return result;
  };

  load();
  channel?.addEventListener('message', () => { load(); publish(); });
  queueMicrotask(publish);

  return {
    mode: 'demo',
    record: (op) => run((t) => ops.record(t, op)),
    cancel: (id, by) => run((t) => ops.cancel(t, id, by)),
    pickPreorder: (id, by) => run((t) => ops.pickPreorder(t, id, by)),
    setStock: (id, sizes, by) => run((t) => ops.setStock(t, id, sizes, by)),
    importPreorders: (rows) => run(async (t) => {
      for (const { id, ...row } of rows) {
        const cur = await t.get(['preorders', id]);
        t.set(['preorders', id], { ...cur, ...row });
      }
    })
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

  // Put in any catalogue item the database does not have yet (first run, or a
  // new product such as the totebag). A transaction per item, so two people
  // opening the page at once cannot double-seed or overwrite live numbers.
  const have = new Set((await fs.getDocs(col('stock'))).docs.map((d) => d.id));
  await Promise.all(CATALOG.map((it, i) => have.has(it.id) ? null : fs.runTransaction(db, async (tx) => {
    const r = ref('stock', it.id);
    if (!(await tx.get(r)).exists()) tx.set(r, seedItem(it, i));
  })));

  const run = (fn) => fs.runTransaction(db, (tx) => fn({
    get: async (p) => { const s = await tx.get(ref(...p)); return s.exists() ? s.data() : null; },
    set: (p, d) => tx.set(ref(...p), d),
    update: (p, c) => tx.update(ref(...p), c),
    newId: (c) => fs.doc(col(c)).id
  }));

  const data = { stock: [], log: [], preorders: [] };
  const push = () => emit({ ...data });
  const fail = (err) => onStatus({ error: err });

  fs.onSnapshot(col('stock'), { includeMetadataChanges: true }, (snap) => {
    onStatus({ synced: !snap.metadata.fromCache });
    data.stock = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    push();
  }, fail);
  fs.onSnapshot(fs.query(col('log'), fs.orderBy('at', 'desc'), fs.limit(2000)), (snap) => {
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
    record: (op) => run((t) => ops.record(t, op)),
    cancel: (id, by) => run((t) => ops.cancel(t, id, by)),
    pickPreorder: (id, by) => run((t) => ops.pickPreorder(t, id, by)),
    setStock: (id, sizes, by) => run((t) => ops.setStock(t, id, sizes, by)),
    importPreorders: async (rows) => {
      const batch = fs.writeBatch(db);
      // merge keeps the "sudah diambil" ticks if the list is imported again
      rows.forEach(({ id, ...row }) => batch.set(ref('preorders', id), row, { merge: true }));
      await batch.commit();
    }
  };
}

export async function createStore(emit, onStatus) {
  // ?demo in the address opens a private practice copy (this browser only).
  if (!FIREBASE_CONFIG.projectId || new URLSearchParams(location.search).has('demo')) return demoStore(emit);
  return firebaseStore(emit, onStatus);
}
