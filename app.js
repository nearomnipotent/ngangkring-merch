import { SIZES, CHANNELS, LOW_STOCK, EVENT_ID } from './config.js';
import { createStore, parsePreorders, UserError } from './store.js';

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sizeLabel = (id) => SIZES.find((s) => s.id === id)?.label ?? id;
const channel = (id) => CHANNELS.find((c) => c.id === id) ?? { id, label: id };
const sum = (obj = {}, keys) => keys.reduce((n, k) => n + (obj[k] ?? 0), 0);
const sizeIds = SIZES.map((s) => s.id);
const channelIds = CHANNELS.map((c) => c.id);
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
const fmtDay = (ms) => new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
const isToday = (ms) => new Date(ms).toDateString() === new Date().toDateString();
const SWATCH = { hitam: '#1c1b17', krem: '#e8dcc0', putih: '#ffffff' };
const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M3 8.5l3.2 3L13 4.5"/></svg>';

// ---------- state ----------
let store;
let data = { stock: [], log: [], preorders: [] };
let seenLog = null; // ids already shown, so new remote entries can flash
let me = '';
let logFilter = 'all';
let poFilter = 'open';
let poQuery = '';
let recording = null; // { itemId, size }

try { me = localStorage.getItem('merch-name') || ''; } catch { /* private mode */ }

// ---------- toast ----------
let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), isError ? 4500 : 2600);
}

function showError(err) {
  console.error(err);
  if (err instanceof UserError) return toast(err.message, true);
  if (err?.code === 'permission-denied') return toast('Akses database ditolak. Cek aturan Firestore (README langkah 3).', true);
  toast('Gagal menyimpan. Cek koneksi internet lalu coba lagi.', true);
}

// ---------- name ----------
function renderMe() {
  $('#whoName').textContent = me || 'Isi nama';
  $('#whoAvatar').textContent = me ? me.trim()[0].toUpperCase() : '?';
  $('#whoBtn').toggleAttribute('data-empty', !me);
}
function askName() {
  $('#nameInput').value = me;
  $('#nameDlg').showModal();
  $('#nameInput').focus();
}
$('#whoBtn').addEventListener('click', askName);
$('#nameForm').addEventListener('submit', () => {
  me = $('#nameInput').value.trim();
  try { localStorage.setItem('merch-name', me); } catch { /* ignore */ }
  renderMe();
  if (pendingAfterName) { const fn = pendingAfterName; pendingAfterName = null; fn(); }
});
let pendingAfterName = null;
function needName(fn) {
  if (me) return fn();
  pendingAfterName = fn;
  askName();
}

// ---------- KPIs & lede ----------
function renderHead() {
  const left = data.stock.reduce((n, it) => n + sum(it.sizes, sizeIds), 0);
  const taken = Object.fromEntries(channelIds.map((c) => [c, data.stock.reduce((n, it) => n + (it.taken?.[c] ?? 0), 0)]));
  const out = sum(taken, channelIds);
  const today = data.log.filter((e) => !e.cancelled && isToday(e.at)).reduce((n, e) => n + e.qty, 0);
  const lastLive = data.log.find((e) => !e.cancelled);

  $('#kpis').innerHTML =
    `<div><dt>Sisa stok</dt><dd>${left}<small>pcs</small></dd></div>` +
    CHANNELS.map((c) => `<div><dt><i class="dot ${c.id}"></i>${esc(c.label)}</dt><dd>${taken[c.id]}<small>pcs</small></dd></div>`).join('');

  if (!data.stock.length) { $('#lede').textContent = 'Memuat data…'; return; }
  $('#lede').innerHTML =
    `<b>${out} pcs</b> sudah keluar, <b>${today}</b> di antaranya hari ini.` +
    (lastLive ? ` Terakhir: ${esc(lastLive.by)} pukul ${fmtTime(lastLive.at)}.` : ' Belum ada pengambilan.');
}

// ---------- stock grid ----------
$('#sizesHead').innerHTML = SIZES.map((s) => `<span>${s.label}</span>`).join('');
$('#lowN').textContent = LOW_STOCK;
$('#channelLegend').innerHTML = CHANNELS.map((c) => `<span><i class="dot ${c.id}"></i>${esc(c.label)}</span>`).join('');

function renderStock(changedCells = new Set()) {
  const items = [...data.stock].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const totals = Object.fromEntries(sizeIds.map((s) => [s, items.reduce((n, it) => n + (it.sizes?.[s] ?? 0), 0)]));
  const takenTotals = Object.fromEntries(channelIds.map((c) => [c, items.reduce((n, it) => n + (it.taken?.[c] ?? 0), 0)]));

  const rows = items.map((it) => {
    const cells = SIZES.map((s) => {
      const n = it.sizes?.[s.id] ?? 0;
      const cls = n === 0 ? 'zero' : n <= LOW_STOCK ? 'low' : '';
      const key = `${it.id}:${s.id}`;
      return `<button type="button" class="cell ${cls} ${changedCells.has(key) ? 'bump' : ''}" data-item="${esc(it.id)}" data-size="${s.id}"
        ${n === 0 ? 'aria-disabled="true"' : ''} aria-label="${esc(it.design)} ${esc(it.warna)} ukuran ${s.label}, sisa ${n}">
        <span class="sz">${s.label}</span>${n === 0 ? '—' : n}</button>`;
    }).join('');
    const taken = CHANNELS.map((c) => `<span title="${esc(c.label)}"><i class="dot ${c.id}"></i><b>${it.taken?.[c.id] ?? 0}</b></span>`).join('');
    return `<div class="stock-row">
      <div class="item-name"><strong>${esc(it.design)}</strong>
        <span><i class="swatch" style="background:${SWATCH[String(it.warna).toLowerCase()] ?? '#ccc'}"></i>${esc(it.warna)}</span></div>
      <div class="sizes">${cells}</div>
      <div class="left-total">${sum(it.sizes, sizeIds)}</div>
      <div class="taken" aria-label="Sudah keluar">${taken}</div>
    </div>`;
  }).join('');

  const totalRow = items.length ? `<div class="stock-row total">
      <div class="item-name"><strong>Total</strong></div>
      <div class="sizes">${SIZES.map((s) => `<span data-sz="${s.label}">${totals[s.id]}</span>`).join('')}</div>
      <div class="left-total">${sum(totals, sizeIds)}</div>
      <div class="taken">${CHANNELS.map((c) => `<span title="${esc(c.label)}"><i class="dot ${c.id}"></i><b>${takenTotals[c.id]}</b></span>`).join('')}</div>
    </div>` : '';

  $('#stockRows').innerHTML = rows + totalRow || '<p class="empty">Memuat stok…</p>';
}

$('#stockRows').addEventListener('click', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell) return;
  if (cell.hasAttribute('aria-disabled')) return toast(`Ukuran ${sizeLabel(cell.dataset.size)} sudah habis.`, true);
  needName(() => openRecord(cell.dataset.item, cell.dataset.size));
});

// ---------- record dialog ----------
$('#recChannels').insertAdjacentHTML('beforeend', CHANNELS.map((c, i) =>
  `<label><input type="radio" name="channel" value="${c.id}" ${i === 0 ? 'checked' : ''}><i class="dot ${c.id}"></i>${esc(c.label)}</label>`
).join(''));

function currentLeft() {
  const it = data.stock.find((s) => s.id === recording?.itemId);
  return it?.sizes?.[recording.size] ?? 0;
}
function openRecord(itemId, size) {
  const it = data.stock.find((s) => s.id === itemId);
  if (!it) return;
  recording = { itemId, size };
  $('#recTitle').textContent = `${it.design} ${it.warna} · ${sizeLabel(size)}`;
  $('#recQty').value = 1;
  $('#recBuyer').value = '';
  $('#recError').textContent = '';
  updateRecordLeft();
  $('#recordDlg').showModal();
  $('#recSubmit').focus();
}
function updateRecordLeft() {
  if (!recording) return;
  const left = currentLeft();
  $('#recLeft').textContent = `Sisa ${left} pcs saat ini.`;
  $('#recQty').max = left;
}
$$('.stepper button').forEach((b) => b.addEventListener('click', () => {
  const q = $('#recQty');
  q.value = Math.max(1, Math.min(currentLeft() || 1, (parseInt(q.value, 10) || 1) + Number(b.dataset.step)));
}));
$('#recordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const qty = parseInt($('#recQty').value, 10);
  const op = {
    ...recording,
    qty,
    channel: $('#recordForm').channel.value,
    buyer: $('#recBuyer').value.trim(),
    by: me
  };
  const btn = $('#recSubmit');
  btn.disabled = true;
  try {
    await store.record(op);
    $('#recordDlg').close();
    toast(`Tercatat: ${qty}× ${sizeLabel(op.size)}, ${channel(op.channel).label}.`);
  } catch (err) {
    if (err instanceof UserError) $('#recError').textContent = err.message;
    else showError(err);
  } finally {
    btn.disabled = false;
  }
});
$$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
$('#recordDlg').addEventListener('close', () => { recording = null; });

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

function renderLog() {
  const fresh = new Set();
  if (seenLog) data.log.forEach((e) => { if (!seenLog.has(e.id)) fresh.add(e.id); });
  seenLog = new Set(data.log.map((e) => e.id));

  const list = data.log.filter((e) => logFilter === 'all' || e.channel === logFilter);
  $('#logTabCount').textContent = data.log.filter((e) => !e.cancelled).length || '';
  $('#logList').innerHTML = list.length
    ? list.slice(0, 300).map((e) => {
      const c = channel(e.channel);
      return `<li class="${e.cancelled ? 'cancelled' : ''} ${fresh.has(e.id) ? 'fresh' : ''}">
        <span class="what"><b>${e.qty}×</b> ${esc(e.itemName)} <b>${esc(sizeLabel(e.size))}</b></span>
        <time datetime="${new Date(e.at).toISOString()}" title="${fmtDay(e.at)}">${isToday(e.at) ? '' : fmtDay(e.at) + ' '}${fmtTime(e.at)}</time>
        <span class="meta"><span class="ch"><i class="dot ${c.id}"></i>${esc(c.label)}</span>
          ${e.buyer ? `<span>untuk ${esc(e.buyer)}</span>` : ''}
          <span>oleh ${esc(e.by)}</span>
          ${e.cancelled ? `<span>· dibatalkan ${esc(e.cancelledBy)}</span>` : ''}</span>
        ${e.cancelled ? '' : `<button type="button" class="undo" data-cancel="${esc(e.id)}">Batalkan</button>`}
      </li>`;
    }).join('')
    : `<li class="empty">${data.log.length ? 'Tidak ada catatan di jalur ini.' : 'Belum ada pengambilan. Ketuk angka ukuran di tabel stok untuk mulai mencatat.'}</li>`;
}

$('#logList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cancel]');
  if (!b) return;
  const entry = data.log.find((x) => x.id === b.dataset.cancel);
  if (!entry) return;
  needName(async () => {
    if (!confirm(`Batalkan ${entry.qty}× ${entry.itemName} ${sizeLabel(entry.size)}? Stok akan dikembalikan.`)) return;
    try {
      await store.cancel(entry.id, me);
      toast('Dibatalkan, stok dikembalikan.');
    } catch (err) { showError(err); }
  });
});

// ---------- pre-orders ----------
function renderPreorders() {
  const all = [...data.preorders].sort((a, b) => (a.no ?? 0) - (b.no ?? 0));
  const done = all.filter((p) => p.picked).length;
  $('#poTabCount').textContent = all.length ? `${done}/${all.length}` : '';
  $('#poSummary').textContent = all.length
    ? `${done} dari ${all.length} pemesan sudah mengambil. Tandai saat pesanan diserahkan.`
    : 'Belum ada daftar. Tekan "Impor daftar" dan tempel baris dari Google Sheet.';

  const q = poQuery.toLowerCase();
  const list = all.filter((p) =>
    (poFilter === 'all' || (poFilter === 'done') === !!p.picked) &&
    (!q || `${p.name} ${p.product} ${p.category} ${p.no}`.toLowerCase().includes(q))
  );

  $('#poList').innerHTML = list.length
    ? list.map((p) => `<li class="row ${p.picked ? 'picked' : ''}">
        <span class="po-name"><span class="no">${esc(p.no)}.</span>${p.name ? esc(p.name) : '<span class="anon">Tanpa nama</span>'}${p.category ? `<span class="pill">${esc(p.category)}</span>` : ''}</span>
        <span class="po-meta">${esc(p.product)} · ukuran <b>${esc(p.size)}</b> · ${esc(p.qty)} pcs</span>
        <span class="po-act">
          ${p.picked
            ? `<span class="done-tag">${CHECK}Diambil ${p.pickedAt ? fmtTime(p.pickedAt) : ''}</span>
               <span class="po-meta">oleh ${esc(p.pickedBy)} · <button type="button" class="link" data-unpick="${esc(p.id)}">batalkan</button></span>`
            : `<button type="button" class="btn" data-pick="${esc(p.id)}">Tandai diambil</button>`}
        </span>
      </li>`).join('')
    : `<li class="empty">${all.length ? 'Tidak ada yang cocok.' : 'Daftar pre-order masih kosong.'}</li>`;
}

$('#poList').addEventListener('click', (e) => {
  const pick = e.target.closest('[data-pick]');
  const unpick = e.target.closest('[data-unpick]');
  const id = pick?.dataset.pick ?? unpick?.dataset.unpick;
  if (!id) return;
  needName(async () => {
    try {
      await store.setPicked(id, !!pick, me);
      if (pick) toast('Ditandai sudah diambil.');
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
$$('[data-export]').forEach((b) => b.addEventListener('click', () => {
  const kind = b.dataset.export;
  if (kind === 'stock') {
    download('stok', [
      ['Design', 'Warna', ...SIZES.map((s) => s.label), 'Sisa', ...CHANNELS.map((c) => c.label)],
      ...[...data.stock].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((it) =>
        [it.design, it.warna, ...sizeIds.map((s) => it.sizes?.[s] ?? 0), sum(it.sizes, sizeIds), ...channelIds.map((c) => it.taken?.[c] ?? 0)])
    ]);
  } else if (kind === 'log') {
    download('riwayat', [
      ['Tanggal', 'Jam', 'Panitia', 'Item', 'Ukuran', 'Jumlah', 'Jalur', 'Pembeli', 'Status'],
      ...[...data.log].reverse().map((e) => [fmtDay(e.at), fmtTime(e.at), e.by, e.itemName, sizeLabel(e.size), e.qty, channel(e.channel).label, e.buyer,
        e.cancelled ? `Dibatalkan oleh ${e.cancelledBy}` : 'OK'])
    ]);
  } else {
    download('pre-order', [
      ['No', 'Nama', 'Produk', 'Ukuran', 'Jumlah', 'Kategori', 'Sudah diambil?', 'Diserahkan oleh', 'Jam'],
      ...[...data.preorders].sort((a, b) => a.no - b.no).map((p) => [p.no, p.name, p.product, p.size, p.qty, p.category,
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
  // which size cells changed, so they can flash when someone else records
  const changed = new Set();
  for (const it of next.stock) {
    const prev = data.stock.find((p) => p.id === it.id);
    if (prev) sizeIds.forEach((s) => { if ((prev.sizes?.[s] ?? 0) !== (it.sizes?.[s] ?? 0)) changed.add(`${it.id}:${s}`); });
  }
  data = next;
  renderHead();
  renderStock(changed);
  renderLog();
  renderPreorders();
  updateRecordLeft();
}

renderMe();
renderHead();
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
