import { CATALOG, CHANNELS, LOW_STOCK, EVENT_ID, PRICES } from './config.js?v=3';
import { createStore, parsePreorders, UserError, catalogItem, sizesFor, sizeLabel, priceOf, matchPreorder } from './store.js?v=3';

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rp = (n) => 'Rp' + new Intl.NumberFormat('id-ID').format(n || 0);
const channel = (id) => CHANNELS.find((c) => c.id === id) ?? { id, label: id };
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
const fmtDay = (ms) => new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
const isToday = (ms) => new Date(ms).toDateString() === new Date().toDateString();
const SWATCH = { hitam: '#1c1b17', krem: '#e8dcc0', putih: '#ffffff', natural: '#efe3c8' };
const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M3 8.5l3.2 3L13 4.5"/></svg>';

// Live database row merged with the catalogue (photo, type, price).
const view = (it) => {
  const c = catalogItem(it.id) ?? {};
  const type = it.type ?? c.type ?? 'kaos';
  return { ...it, type, img: c.img ?? '', price: PRICES[type] ?? PRICES.kaos, name: type === 'totebag' ? it.design : `${it.design} ${it.warna}` };
};
const leftOf = (it) => sizesFor(it.type).reduce((n, s) => n + (it.sizes?.[s.id] ?? 0), 0);
const sales = () => data.log.filter((e) => e.type !== 'adjust' && !e.cancelled);
const amountOf = (e) => e.amount ?? (e.price ?? priceOf(e.itemId)) * (e.qty ?? 0);

// ---------- state ----------
let store;
let data = { stock: [], log: [], preorders: [] };
let seenLog = null;
let me = '';
let logFilter = 'all';
let poFilter = 'open';
let poQuery = '';
let recording = null; // { itemId, size }
let stocking = null; // itemId
let lastTotal = null;

try { me = localStorage.getItem('merch-name') || ''; } catch { /* private mode */ }

// ---------- toast ----------
let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), isError ? 4500 : 3000);
}
function showError(err) {
  console.error(err);
  if (err instanceof UserError) return toast(err.message, true);
  if (err?.code === 'permission-denied') return toast('Akses database ditolak. Cek aturan Firestore.', true);
  toast('Gagal menyimpan. Cek koneksi internet lalu coba lagi.', true);
}

// ---------- name ----------
function renderMe() {
  $('#whoName').textContent = me || 'Isi nama';
  $('#whoAvatar').textContent = me ? me.trim()[0].toUpperCase() : '?';
  $('#whoBtn').toggleAttribute('data-empty', !me);
}
let pendingAfterName = null;
function askName() {
  $('#nameInput').value = me;
  $('#nameDlg').showModal();
  $('#nameInput').focus();
}
function needName(fn) {
  if (me) return fn();
  pendingAfterName = fn;
  askName();
}
$('#whoBtn').addEventListener('click', askName);
$('#nameForm').addEventListener('submit', () => {
  me = $('#nameInput').value.trim();
  try { localStorage.setItem('merch-name', me); } catch { /* ignore */ }
  renderMe();
  if (pendingAfterName) { const fn = pendingAfterName; pendingAfterName = null; fn(); }
});

// ---------- money ----------
function renderMoney() {
  const s = sales();
  const total = s.reduce((n, e) => n + amountOf(e), 0);
  const pcs = s.reduce((n, e) => n + (e.qty ?? 0), 0);
  const items = data.stock.map(view);
  const left = items.reduce((n, it) => n + leftOf(it), 0);
  const potential = items.reduce((n, it) => n + leftOf(it) * it.price, 0);

  const el = $('#moneyTotal');
  el.textContent = rp(total);
  if (lastTotal !== null && total !== lastTotal) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  lastTotal = total;

  if (!data.stock.length) { $('#moneySub').textContent = 'Memuat data…'; }
  else {
    const last = s[0];
    $('#moneySub').innerHTML = `<b>${pcs} pcs</b> keluar · sisa <b>${left} pcs</b> senilai ${rp(potential)}` +
      (last ? `<br>Terakhir: ${esc(last.by)} pukul ${fmtTime(last.at)}` : '');
  }

  $('#moneySplit').innerHTML = CHANNELS.map((c) => {
    const cs = s.filter((e) => e.channel === c.id);
    return `<div><dt><i class="dot ${c.id}"></i>${esc(c.label)}</dt>
      <dd>${rp(cs.reduce((n, e) => n + amountOf(e), 0))}<small>${cs.reduce((n, e) => n + (e.qty ?? 0), 0)} pcs</small></dd></div>`;
  }).join('');
}

// ---------- catalogue ----------
$('#lowN').textContent = LOW_STOCK;
let catalogDrawn = false;

function renderCatalog(changedCells = new Set()) {
  const items = [...data.stock].map(view).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (!items.length) { $('#catalog').innerHTML = '<p class="empty">Memuat katalog…</p>'; return; }
  $('#catalog').innerHTML = items.map((it, i) => {
    const sizes = sizesFor(it.type);
    const left = leftOf(it);
    const cells = sizes.map((s) => {
      const n = it.sizes?.[s.id] ?? 0;
      const cls = n === 0 ? 'zero' : n <= LOW_STOCK ? 'low' : '';
      return `<button type="button" class="cell ${cls} ${changedCells.has(`${it.id}:${s.id}`) ? 'bump' : ''}" data-item="${esc(it.id)}" data-size="${s.id}"
        ${n === 0 ? 'aria-disabled="true"' : ''} aria-label="${esc(it.name)} ${s.label}, sisa ${n}">
        <span class="sz">${s.label}</span><span class="n">${n === 0 ? '—' : n}</span></button>`;
    }).join('');
    const taken = CHANNELS.map((c) => `<span title="${esc(c.label)}"><i class="dot ${c.id}"></i><b>${it.taken?.[c.id] ?? 0}</b></span>`).join('');
    return `<article class="card" style="${catalogDrawn ? 'animation:none' : `--i:${i}`}">
      <div class="card-pic">
        ${it.img ? `<img src="${esc(it.img)}" alt="${esc(it.name)}" loading="lazy" width="640" height="640">` : ''}
        <span class="price">${rp(it.price)}</span>
        <span class="left-badge ${left ? '' : 'out'}">${left ? `Sisa ${left}` : 'Habis'}</span>
      </div>
      <div class="card-body">
        <div class="card-title"><h3>${esc(it.design)}</h3>
          <span class="colour"><i class="swatch" style="background:${SWATCH[String(it.warna).toLowerCase()] ?? '#ccc'}"></i>${esc(it.warna)}</span></div>
        <div class="sizes ${sizes.length === 1 ? 'one' : ''}">${cells}</div>
        <div class="card-foot">
          <span class="taken" aria-label="Sudah keluar per jalur">${taken}</span>
          <button type="button" class="link" data-stock="${esc(it.id)}">Atur stok</button>
        </div>
      </div>
    </article>`;
  }).join('');
  catalogDrawn = true;
}

$('#catalog').addEventListener('click', (e) => {
  const adj = e.target.closest('[data-stock]');
  if (adj) return needName(() => openStock(adj.dataset.stock));
  const cell = e.target.closest('.cell');
  if (!cell) return;
  if (cell.hasAttribute('aria-disabled')) {
    const it = view(data.stock.find((s) => s.id === cell.dataset.item));
    return toast(it.type === 'totebag' ? 'Stok totebag 0. Isi dulu lewat "Atur stok".' : `Ukuran ${sizeLabel(cell.dataset.size)} sudah habis.`, true);
  }
  needName(() => openRecord(cell.dataset.item, cell.dataset.size));
});

// ---------- record dialog ----------
$('#recChannels').insertAdjacentHTML('beforeend', CHANNELS.map((c, i) =>
  `<label><input type="radio" name="channel" value="${c.id}" ${i === CHANNELS.length - 1 ? 'checked' : ''}><i class="dot ${c.id}"></i>${esc(c.label)}</label>`
).join(''));

function currentLeft() {
  const it = data.stock.find((s) => s.id === recording?.itemId);
  return it?.sizes?.[recording.size] ?? 0;
}
function openRecord(itemId, size) {
  const raw = data.stock.find((s) => s.id === itemId);
  if (!raw) return;
  const it = view(raw);
  recording = { itemId, size };
  $('#recImg').src = it.img;
  $('#recTitle').textContent = it.type === 'totebag' ? it.name : `${it.name} · ${sizeLabel(size)}`;
  $('#recQty').value = 1;
  $('#recBuyer').value = '';
  $('#recError').textContent = '';
  updateRecord();
  $('#recordDlg').showModal();
  $('#recSubmit').focus();
}
function updateRecord() {
  if (!recording) return;
  const left = currentLeft();
  const qty = Math.max(1, parseInt($('#recQty').value, 10) || 1);
  const total = priceOf(recording.itemId) * qty;
  $('#recLeft').textContent = `${rp(priceOf(recording.itemId))} / pcs · sisa ${left} pcs`;
  $('#recTotal').textContent = rp(total);
  $('#recSubmit').textContent = `Catat · ${rp(total)}`;
}
$$('.stepper button').forEach((b) => b.addEventListener('click', () => {
  const q = $('#recQty');
  q.value = Math.max(1, Math.min(currentLeft() || 1, (parseInt(q.value, 10) || 1) + Number(b.dataset.step)));
  updateRecord();
}));
$('#recQty').addEventListener('input', updateRecord);
$('#recordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const qty = parseInt($('#recQty').value, 10);
  const op = { ...recording, qty, channel: $('#recordForm').channel.value, buyer: $('#recBuyer').value.trim(), by: me };
  const btn = $('#recSubmit');
  btn.disabled = true;
  try {
    await store.record(op);
    $('#recordDlg').close();
    toast(`Tercatat ${qty}× ${sizeLabel(op.size)}, ${channel(op.channel).label} · ${rp(priceOf(op.itemId) * qty)}`);
  } catch (err) {
    if (err instanceof UserError) $('#recError').textContent = err.message;
    else showError(err);
  } finally {
    btn.disabled = false;
  }
});
$$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
$('#recordDlg').addEventListener('close', () => { recording = null; });

// ---------- stock dialog ----------
function openStock(itemId) {
  const raw = data.stock.find((s) => s.id === itemId);
  if (!raw) return;
  const it = view(raw);
  stocking = itemId;
  const sizes = sizesFor(it.type);
  $('#stockDlgTitle').textContent = `Atur stok · ${it.name}`;
  $('#stockInputs').className = `stock-inputs ${sizes.length === 1 ? 'one' : ''}`;
  $('#stockInputs').innerHTML = sizes.map((s) =>
    `<label>${s.label}<input type="number" inputmode="numeric" min="0" step="1" name="${s.id}" value="${it.sizes?.[s.id] ?? 0}"></label>`).join('');
  $('#stockError').textContent = '';
  $('#stockDlg').showModal();
  $('#stockInputs input').select();
}
$('#stockForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const sizes = Object.fromEntries($$('#stockInputs input').map((i) => [i.name, Number(i.value)]));
  try {
    const changed = await store.setStock(stocking, sizes, me);
    $('#stockDlg').close();
    toast(changed ? 'Stok diperbarui.' : 'Tidak ada perubahan.');
  } catch (err) {
    if (err instanceof UserError) $('#stockError').textContent = err.message;
    else showError(err);
  }
});

// ---------- log ----------
$('#logFilters').innerHTML = [{ id: 'all', label: 'Semua' }, ...CHANNELS].map((c) =>
  `<button type="button" class="chip" data-log-filter="${c.id}" aria-pressed="${c.id === logFilter}">${c.id !== 'all' ? `<i class="dot ${c.id}"></i>` : ''}${esc(c.label)}</button>`
).join('');
$('#logFilters').addEventListener('click', (e) => {
  const b = e.target.closest('[data-log-filter]');
  if (!b) return;
  logFilter = b.dataset.logFilter;
  $$('[data-log-filter]').forEach((x) => x.setAttribute('aria-pressed', x === b));
  renderLog();
});

const timeTag = (at) => `<time datetime="${new Date(at).toISOString()}">${isToday(at) ? '' : fmtDay(at) + ' '}${fmtTime(at)}</time>`;

function renderLog() {
  const fresh = new Set();
  if (seenLog) data.log.forEach((e) => { if (!seenLog.has(e.id)) fresh.add(e.id); });
  seenLog = new Set(data.log.map((e) => e.id));

  const list = data.log.filter((e) => logFilter === 'all' || e.channel === logFilter);
  $('#logTabCount').textContent = sales().length || '';
  $('#logList').innerHTML = list.length
    ? list.slice(0, 300).map((e) => {
      if (e.type === 'adjust') {
        return `<li class="adjust ${fresh.has(e.id) ? 'fresh' : ''}">
          <span class="what">Stok ${esc(e.itemName)}: ${esc(e.note)}</span>
          <span class="meta">${timeTag(e.at)} <span>oleh ${esc(e.by)}</span></span></li>`;
      }
      const c = channel(e.channel);
      const size = e.size && e.size !== 'one' ? ` <b>${esc(sizeLabel(e.size))}</b>` : '';
      return `<li class="${e.cancelled ? 'cancelled' : ''} ${fresh.has(e.id) ? 'fresh' : ''}">
        <span class="what"><b>${e.qty}×</b> ${esc(e.itemName)}${size}</span>
        <span class="amt">${rp(amountOf(e))}</span>
        <span class="meta">${timeTag(e.at)} <span class="ch"><i class="dot ${c.id}"></i>${esc(c.label)}</span>
          ${e.buyer ? `<span>· ${esc(e.buyer)}</span>` : ''}
          <span>· oleh ${esc(e.by)}</span>
          ${e.stockTaken === false && !e.cancelled ? `<span>· ${e.reserved ? 'dari jatah PO' : 'stok tidak dipotong'}</span>` : ''}
          ${e.cancelled ? `<span>· dibatalkan ${esc(e.cancelledBy)}</span>` : ''}</span>
        ${e.cancelled ? '' : `<button type="button" class="undo" data-cancel="${esc(e.id)}">Batalkan</button>`}
      </li>`;
    }).join('')
    : `<li class="empty">${data.log.length ? 'Tidak ada catatan di jalur ini.' : 'Belum ada catatan. Ketuk ukuran di katalog untuk mulai.'}</li>`;
}

$('#logList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cancel]');
  if (!b) return;
  const entry = data.log.find((x) => x.id === b.dataset.cancel);
  if (!entry) return;
  needName(async () => {
    const what = `${entry.qty}× ${entry.itemName}${entry.size && entry.size !== 'one' ? ' ' + sizeLabel(entry.size) : ''} (${rp(amountOf(entry))})`;
    if (!confirm(`Batalkan ${what}?${entry.stockTaken ? ' Stok dikembalikan.' : ''}${entry.poId ? ' Pre-order kembali ke "belum diambil".' : ''}`)) return;
    try {
      await store.cancel(entry.id, me);
      toast('Dibatalkan.');
    } catch (err) { showError(err); }
  });
});

// ---------- pre-orders ----------
const poValue = (p) => (PRICES[matchPreorder(p.product, p.size).type] ?? PRICES.kaos) * (Number(p.qty) || 1);

function renderPreorders() {
  const all = [...data.preorders].sort((a, b) => (a.no ?? 0) - (b.no ?? 0));
  const done = all.filter((p) => p.picked);
  $('#poTabCount').textContent = all.length ? `${done.length}/${all.length}` : '';
  $('#poSummary').innerHTML = all.length
    ? `<b>${done.length} dari ${all.length}</b> pemesan sudah mengambil · ${rp(done.reduce((n, p) => n + poValue(p), 0))} dari ${rp(all.reduce((n, p) => n + poValue(p), 0))} tercatat.`
    : 'Belum ada daftar. Tekan "Impor daftar" dan tempel baris dari Google Sheet.';

  const q = poQuery.toLowerCase();
  const list = all.filter((p) =>
    (poFilter === 'all' || (poFilter === 'done') === !!p.picked) &&
    (!q || `${p.name} ${p.product} ${p.category} ${p.no}`.toLowerCase().includes(q))
  );

  $('#poList').innerHTML = list.length
    ? list.map((p) => {
      const m = matchPreorder(p.product, p.size);
      const img = catalogItem(m.itemId)?.img ?? (m.type === 'totebag' ? catalogItem('totebag')?.img : '');
      return `<li class="row ${p.picked ? 'picked' : ''}">
        ${img ? `<img class="po-thumb" src="${esc(img)}" alt="" loading="lazy">` : '<span class="po-thumb"></span>'}
        <span class="po-name"><span class="no">${esc(p.no)}.</span>${p.name ? esc(p.name) : '<span class="anon">Tanpa nama</span>'}${p.category ? `<span class="pill">${esc(p.category)}</span>` : ''}</span>
        <span class="po-meta">${esc(p.product)} · <b>${esc(p.size)}</b> · ${esc(p.qty)} pcs · ${rp(poValue(p))}</span>
        <span class="po-act">
          ${p.picked
            ? `<span class="done-tag">${CHECK}Diambil ${p.pickedAt ? fmtTime(p.pickedAt) : ''}</span>
               <span class="po-meta">oleh ${esc(p.pickedBy)}${p.logId ? ` · <button type="button" class="link" data-unpick="${esc(p.logId)}">batalkan</button>` : ''}</span>`
            : `<button type="button" class="btn" data-pick="${esc(p.id)}">Tandai diambil</button>`}
        </span>
      </li>`;
    }).join('')
    : `<li class="empty">${all.length ? 'Tidak ada yang cocok.' : 'Daftar pre-order masih kosong.'}</li>`;
}

$('#poList').addEventListener('click', (e) => {
  const pick = e.target.closest('[data-pick]');
  const unpick = e.target.closest('[data-unpick]');
  if (!pick && !unpick) return;
  needName(async () => {
    try {
      if (pick) {
        const r = await store.pickPreorder(pick.dataset.pick, me);
        toast(r?.stockTaken ? 'Diambil. Stok dipotong, uang tercatat.'
          : r?.reserved ? 'Diambil. Uang tercatat (barang PO sudah disisihkan dari stok).'
          : 'Diambil. Uang tercatat; stok tidak dipotong (ukuran/produk tidak cocok atau habis).');
      } else {
        if (!confirm('Batalkan pengambilan ini? Uang dan stok dikembalikan.')) return;
        await store.cancel(unpick.dataset.unpick, me);
        toast('Pengambilan dibatalkan.');
      }
    } catch (err) { showError(err); }
  });
});
$('#poSearch').addEventListener('input', (e) => { poQuery = e.target.value.trim(); renderPreorders(); });
$$('[data-po-filter]').forEach((b) => b.addEventListener('click', () => {
  poFilter = b.dataset.poFilter;
  $$('[data-po-filter]').forEach((x) => x.setAttribute('aria-pressed', x === b));
  renderPreorders();
}));

// import
$('#importBtn').addEventListener('click', () => {
  $('#importText').value = '';
  $('#importPreview').textContent = '';
  $('#importSubmit').disabled = true;
  $('#importDlg').showModal();
});
$('#importText').addEventListener('input', () => {
  const rows = parsePreorders($('#importText').value);
  $('#importPreview').textContent = rows.length ? `${rows.length} baris pemesan terbaca.` : 'Belum ada baris yang terbaca. Pastikan kolom nomor ikut disalin.';
  $('#importSubmit').disabled = !rows.length;
});
$('#importForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const rows = parsePreorders($('#importText').value);
  try {
    await store.importPreorders(rows);
    $('#importDlg').close();
    toast(`${rows.length} pemesan diimpor.`);
  } catch (err) { showError(err); }
});

// ---------- tabs (phone & tablet) ----------
$$('[data-tab]').forEach((t) => t.addEventListener('click', () => {
  $$('[data-tab]').forEach((x) => x.setAttribute('aria-selected', x === t));
  $$('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== t.dataset.tab));
}));

// ---------- CSV export ----------
function download(name, rows) {
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${EVENT_ID}-${name}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const KAOS_SIZES = sizesFor('kaos');
$$('[data-export]').forEach((b) => b.addEventListener('click', () => {
  const kind = b.dataset.export;
  if (kind === 'stock') {
    download('stok', [
      ['Produk', 'Warna', 'Harga', ...KAOS_SIZES.map((s) => s.label), 'Totebag', 'Sisa', ...CHANNELS.map((c) => `Keluar ${c.label}`)],
      ...[...data.stock].map(view).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((it) => [
        it.design, it.warna, it.price,
        ...KAOS_SIZES.map((s) => (it.type === 'kaos' ? it.sizes?.[s.id] ?? 0 : '')),
        it.type === 'totebag' ? it.sizes?.one ?? 0 : '',
        leftOf(it), ...CHANNELS.map((c) => it.taken?.[c.id] ?? 0)])
    ]);
  } else if (kind === 'log') {
    download('riwayat', [
      ['Tanggal', 'Jam', 'Panitia', 'Jenis', 'Item', 'Ukuran', 'Jumlah', 'Harga', 'Total', 'Jalur', 'Pembeli', 'Status'],
      ...[...data.log].reverse().map((e) => e.type === 'adjust'
        ? [fmtDay(e.at), fmtTime(e.at), e.by, 'Atur stok', e.itemName, '', '', '', '', '', '', e.note]
        : [fmtDay(e.at), fmtTime(e.at), e.by, 'Penjualan', e.itemName, e.size === 'one' ? '' : sizeLabel(e.size), e.qty,
          e.price ?? priceOf(e.itemId), amountOf(e), channel(e.channel).label, e.buyer,
          e.cancelled ? `Dibatalkan oleh ${e.cancelledBy}` : e.stockTaken === false ? (e.reserved ? 'OK (jatah PO)' : 'OK (stok tidak dipotong)') : 'OK'])
    ]);
  } else {
    download('pre-order', [
      ['No', 'Nama', 'Produk', 'Ukuran', 'Jumlah', 'Kategori', 'Nilai', 'Sudah diambil?', 'Diserahkan oleh', 'Jam'],
      ...[...data.preorders].sort((a, b) => a.no - b.no).map((p) => [p.no, p.name, p.product, p.size, p.qty, p.category, poValue(p),
        p.picked ? 'TRUE' : 'FALSE', p.pickedBy, p.pickedAt ? fmtTime(p.pickedAt) : ''])
    ]);
  }
}));

// ---------- sync status ----------
function setSync(state, text) {
  const el = $('#sync');
  el.dataset.state = state;
  el.lastElementChild.textContent = text;
}
window.addEventListener('offline', () => setSync('offline', 'Offline, akan tersimpan saat online'));
window.addEventListener('online', () => store?.mode === 'live' && setSync('live', 'Tersambung langsung'));

// ---------- boot ----------
function onData(next) {
  const changed = new Set();
  for (const it of next.stock) {
    const prev = data.stock.find((p) => p.id === it.id);
    if (prev) Object.keys(it.sizes ?? {}).forEach((s) => { if ((prev.sizes?.[s] ?? 0) !== (it.sizes?.[s] ?? 0)) changed.add(`${it.id}:${s}`); });
  }
  data = next;
  renderMoney();
  renderCatalog(changed);
  renderLog();
  renderPreorders();
  updateRecord();
}

renderMe();
renderMoney();
renderCatalog();
try {
  store = await createStore(onData, ({ synced, error }) => {
    if (error) { showError(error); setSync('error', 'Gagal tersambung'); return; }
    if (!navigator.onLine) return setSync('offline', 'Offline, akan tersimpan saat online');
    setSync('live', synced ? 'Tersambung langsung' : 'Menyambung…');
  });
  if (store.mode === 'demo') {
    setSync('demo', 'Mode demo');
    $('#demoNote').hidden = false;
  }
  if (!me) askName();
} catch (err) {
  console.error(err);
  setSync('error', 'Gagal tersambung');
  toast('Tidak bisa tersambung ke database. Cek config.js dan koneksi internet.', true);
}
