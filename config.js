// ============================================================
//  SETTINGS — the only file you need to edit.
// ============================================================

// 1. Paste your Firebase web config here (see README, step 2).
//    While this is empty the page runs in DEMO MODE: data is saved only
//    in this browser, so other people will NOT see your changes.
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCwUpcvclXf2ed7aHBBle7NkBUjuAE5A1E",
  authDomain: "ngangkring-kafispolgama.firebaseapp.com",
  projectId: "ngangkring-kafispolgama",
  storageBucket: "ngangkring-kafispolgama.firebasestorage.app",
  messagingSenderId: "761855573957",
  appId: "1:761855573957:web:461c639e6ace36c85155ac"
};

// 2. Name of this event's data. Change it to start a fresh, empty record
//    (for example for a test run before the real day).
export const EVENT_ID = 'ngangkring-2026';

// 3. Starting stock, copied from the STORAGE tab of the committee sheet.
//    Only used the very first time the page opens with an empty database.
//    After that, the live numbers in the database are the truth.
export const INITIAL_STOCK = [
  { id: 'senang-lawan_hitam', design: 'Senang-Lawan',      warna: 'Hitam', sizes: { s: 10, m: 27, l: 30, xl: 42, xxl: 11, xxxl: 2 } },
  { id: 'senang-lawan_krem',  design: 'Senang-Lawan',      warna: 'Krem',  sizes: { s: 2,  m: 7,  l: 12, xl: 20, xxl: 5,  xxxl: 2 } },
  { id: 'sansiro_hitam',      design: 'Sansiro Easy Life', warna: 'Hitam', sizes: { s: 3,  m: 9,  l: 16, xl: 27, xxl: 7,  xxxl: 2 } },
  { id: 'sansiro_putih',      design: 'Sansiro Easy Life', warna: 'Putih', sizes: { s: 1,  m: 2,  l: 4,  xl: 7,  xxl: 2,  xxxl: 0 } },
  { id: 'fisipol_hitam',      design: 'FISIPOL',           warna: 'Hitam', sizes: { s: 2,  m: 8,  l: 13, xl: 21, xxl: 5,  xxxl: 1 } }
];

export const SIZES = [
  { id: 's', label: 'S' },
  { id: 'm', label: 'M' },
  { id: 'l', label: 'L' },
  { id: 'xl', label: 'XL' },
  { id: 'xxl', label: '2XL' },
  { id: 'xxxl', label: '3XL' }
];

// How a shirt left the table. Shown as the three "jalur" in the form.
export const CHANNELS = [
  { id: 'po', label: 'Pre-order' },
  { id: 'bundling', label: 'Bundling + Registrasi' },
  { id: 'ots', label: 'On The Spot' }
];

// A size cell turns orange when this many or fewer are left.
export const LOW_STOCK = 3;
