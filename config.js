// ============================================================
//  SETTINGS — the only file you need to edit.
// ============================================================

// 1. Firebase web config (project "ngangkring-kafispolgama").
//    If this is emptied the page falls back to DEMO MODE (this browser only).
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCwUpcvclXf2ed7aHBBle7NkBUjuAE5A1E",
  authDomain: "ngangkring-kafispolgama.firebaseapp.com",
  projectId: "ngangkring-kafispolgama",
  storageBucket: "ngangkring-kafispolgama.firebasestorage.app",
  messagingSenderId: "761855573957",
  appId: "1:761855573957:web:461c639e6ace36c85155ac"
};

// 2. Name of this event's data. Change it to start a fresh, empty record.
export const EVENT_ID = 'ngangkring-2026';

// 3. Base prices (Rupiah). Every pickup and sale is counted at these prices,
//    including pre-orders collected at the table.
export const PRICES = { kaos: 135000, totebag: 100000 };

// 4. The catalogue. `sizes` is the starting stock, copied from the STORAGE tab.
//    It is only written to the database when an item does not exist there yet;
//    after that the live numbers in the database are the truth
//    (change them on the page with "Atur stok").
export const CATALOG = [
  { id: 'senang-lawan_hitam', type: 'kaos', design: 'Senang-Lawan', warna: 'Hitam', img: 'img/senang-lawan_hitam.webp',
    sizes: { s: 10, m: 27, l: 30, xl: 42, xxl: 11, xxxl: 2 } },
  { id: 'senang-lawan_krem', type: 'kaos', design: 'Senang-Lawan', warna: 'Krem', img: 'img/senang-lawan_krem.webp',
    sizes: { s: 2, m: 7, l: 12, xl: 20, xxl: 5, xxxl: 2 } },
  { id: 'sansiro_hitam', type: 'kaos', design: 'Easy Life', warna: 'Hitam', img: 'img/sansiro_hitam.webp',
    sizes: { s: 3, m: 9, l: 16, xl: 27, xxl: 7, xxxl: 2 } },
  { id: 'sansiro_putih', type: 'kaos', design: 'Easy Life', warna: 'Putih', img: 'img/sansiro_putih.webp',
    sizes: { s: 1, m: 2, l: 4, xl: 7, xxl: 2, xxxl: 0 } },
  { id: 'fisipol_hitam', type: 'kaos', design: 'FISIPOL Demo', warna: 'Hitam', img: 'img/fisipol_hitam.webp',
    sizes: { s: 2, m: 8, l: 13, xl: 21, xxl: 5, xxxl: 1 } },
  // Totebag stock is not in the sheet yet: set it on the page with "Atur stok".
  { id: 'totebag', type: 'totebag', design: 'Totebag FISIPOL Demo', warna: 'Natural', img: 'img/totebag.webp',
    sizes: { one: 0 } }
];

export const SIZES_BY_TYPE = {
  kaos: [
    { id: 's', label: 'S' },
    { id: 'm', label: 'M' },
    { id: 'l', label: 'L' },
    { id: 'xl', label: 'XL' },
    { id: 'xxl', label: '2XL' },
    { id: 'xxxl', label: '3XL' }
  ],
  totebag: [{ id: 'one', label: 'Totebag' }]
};

// How an item left the table.
export const CHANNELS = [
  { id: 'po', label: 'Pre-order' },
  { id: 'bundling', label: 'Bundling + Registrasi' },
  { id: 'ots', label: 'On The Spot' }
];

// A size turns orange when this many or fewer are left.
export const LOW_STOCK = 3;
