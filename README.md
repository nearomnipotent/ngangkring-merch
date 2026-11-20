# Merch Ngangkring 2026

A live page for the merch table at Ngangkring Kafispolgama 2026. Everyone on the committee opens the same link on their phone. When one person records a shirt going out, the stock goes down on every screen within a second, and the history shows who handed it over, when, and through which channel.

**What it does**

- **Uang masuk:** the blue panel at the top adds up every pickup and sale at base price (kaos Rp135.000, totebag Rp100.000), split by channel. Pre-order pickups count too.
- **Katalog:** a card per design with its photo, price and remaining stock per size. Tap a size to record a pickup: choose the channel (Pre-order, Bundling + Registrasi, On The Spot), the quantity, and optionally the buyer's name. The total shows before you save. **Atur stok** on a card sets the real count (the totebag starts at 0 until someone fills it in).
- **Pengambilan pre-order:** the list from the "Pengambilan Merchandise" tab. "Tandai diambil" counts the money and takes the matching shirt off the stock. When the product or size does not match the catalogue (for example size "FU"), the money is still counted but no stock is taken, and the history says so.
- **Riwayat:** every record from every committee member, with its amount. "Batalkan" undoes a mistake and puts the stock and money back.
- **Practice copy:** add `?demo` to the address to try everything without touching the real data.
- **Unduh CSV** on each section downloads a recap you can paste into the Google Sheet.

If two people take the last shirt of a size at the same moment, only one record goes through. The other person sees "Stok XL tinggal 0".

---

## Setup (about 10 minutes, once)

> **Already done for this event (20 Nov 2026).** The page is connected to the Firebase project `ngangkring-kafispolgama` (Spark free plan, database in Jakarta), anonymous sign-in is on, the rules are published, and the 18 pre-order names are imported. Open the console at <https://console.firebase.google.com/project/ngangkring-kafispolgama> with the Google account that owns it. The steps below are only needed to set this up again somewhere else.

The page is hosted free on GitHub Pages. GitHub can only host the page, though, so the shared live data goes in a free Firebase database. Until you finish steps 1–4 the page runs in **demo mode**: it works, but the data stays in your own browser only.

### 1. Create a Firebase project
1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. **Create a project** → name it e.g. `ngangkring-merch` → Google Analytics can be turned off → **Create**.

### 2. Add a web app and copy its config
1. On the project home, click the **`</>`** (Web) icon. Nickname: `merch` → **Register app** (no hosting needed).
2. Firebase shows a `firebaseConfig = { ... }` block. Copy the values into [`config.js`](config.js) under `FIREBASE_CONFIG`, like this:
   ```js
   export const FIREBASE_CONFIG = {
     apiKey: "AIza...",
     authDomain: "ngangkring-merch.firebaseapp.com",
     projectId: "ngangkring-merch",
     storageBucket: "ngangkring-merch.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abc123"
   };
   ```
   These values are meant to sit in a public web page. They are not passwords. The rules in step 3 decide who can write.

### 3. Turn on the database
1. Left menu → **Build → Firestore Database** → **Create database** → pick location `asia-southeast2 (Jakarta)` → **Start in production mode** → **Create**.
2. Open the **Rules** tab, replace everything with the contents of [`firestore.rules`](firestore.rules), and click **Publish**.

### 4. Turn on anonymous sign-in
Left menu → **Build → Authentication** → **Get started** → **Sign-in method** → **Anonymous** → enable → **Save**.
(Nobody has to make an account. Each phone gets an invisible ID so the database knows the request comes from the page.)

### 5. Publish the change
Edit `config.js` directly on GitHub (open the file → pencil icon → paste → **Commit changes**). GitHub Pages updates within about a minute. Open the link: the dot in the top-right corner should turn green and say **Tersambung langsung**.

The first time the page connects, it fills the database with the starting stock from the STORAGE tab (written in `config.js`). After that, the database is the source of truth.

### 6. Import the pre-order list
On the page, open **Daftar pre-order** → **Impor daftar**. In the Google Sheet, open the **Pengambilan Merchandise** tab, select the rows (including the No column), copy them, paste them into the box, and click **Impor**. You can import again later when new orders come in: the existing ticks are kept.

> The buyers' names are deliberately **not** stored in this GitHub repository. The repository is public, so names only ever go into the Firebase database.

---

## Panduan singkat untuk panitia

1. Buka link yang dibagikan, isi **nama kamu** saat diminta (sekali saja).
2. Ada yang ambil atau beli? Di **Katalog**, ketuk ukuran yang dimaksud → pilih jalur → jumlah → **Catat · Rp…**. Uang masuk langsung bertambah.
3. Pemesan pre-order datang? Tab **Pre-order** → cari namanya → **Tandai diambil**. Uangnya ikut tercatat.
4. Salah input? Tab **Riwayat** → **Batalkan** pada catatan itu. Stok dan uang kembali otomatis.
5. Jumlah di meja beda dengan di layar? **Atur stok** di kartu produk.
6. Mau latihan dulu? Buka link dengan tambahan `?demo` di belakangnya.
7. Titik hijau di pojok kanan atas = tersambung. Kalau sinyal hilang, input tetap tersimpan dan terkirim otomatis saat online lagi.

Angka oranye = tinggal sedikit (≤ 3). Kotak garis putus-putus = ukuran habis.

---

## Changing things

| I want to… | Do this |
| --- | --- |
| Fix a stock number | **Atur stok** on the product card (logged in Riwayat) |
| Change a price | `PRICES` in `config.js` (applies to new records only) |
| Change a product photo | Replace the file in `img/` (square, white background) |
| Do a test run, then start clean on the day | Test with `EVENT_ID = 'ngangkring-test'` in `config.js`, then change it back to `'ngangkring-2026'` |
| Add a design or colour | Add a line to `CATALOG` in `config.js` with a photo in `img/`. The page adds it to the database the next time it opens |
| Change the low-stock warning | `LOW_STOCK` in `config.js` |

## Files

| File | What it is |
| --- | --- |
| `index.html` | The page |
| `styles.css` | The look, including the phone layout |
| `app.js` | What the buttons do |
| `store.js` | Saving and live sync (Firebase, or demo mode in the browser) |
| `config.js` | **Your settings:** Firebase keys, event ID, prices, catalogue and starting stock |
| `img/` | Product photos, taken from the sheet and the Instagram posts |
| `firestore.rules` | Database access rules to paste into Firebase |

No build step, no install. To try it on your computer, run any static server in this folder, for example `npx http-server .`, and open the address it prints.
