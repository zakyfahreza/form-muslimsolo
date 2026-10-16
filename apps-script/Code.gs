/**
 * Backend pendaftaran Daurah "Tajidul Iman" - Muslim Solo
 * Google Apps Script (V8). Salin seluruh isi file ini ke editor Apps Script
 * yang terikat (bound) ke Google Spreadsheet pendaftaran.
 *
 * Server adalah OTORITAS validasi (architecture.md). Jangan longgarkan aturan di sini.
 */

/* ------------------------------------------------------------------------
   KONFIGURASI
   ------------------------------------------------------------------------ */
const CONFIG = {
  // Tab per jenis kelamin. Kolom kedua tab identik.
  SHEETS: { "Laki-laki": "Putra", "Perempuan": "Putri" },
  TAB_COLORS: { "Putra": "#1E40AF", "Putri": "#BE185D" },
  LEGACY_SHEET: "Peserta",          // tab lama (versi satu tab); dihapus setup() bila masih kosong
  // ID folder Drive privat untuk bukti bayar. Boleh juga tempel URL folder lengkap;
  // bagian seperti "?hl=ID" akan dibuang otomatis.
  DRIVE_FOLDER_ID: "16R0FsBp7SCgzPRkqlWMjyEwcr7yb4WjC",
  QUOTA_MAX: 300,                   // 0 = tanpa batas
  REG_PREFIX: "TJI",
  FEE: 20000,
  MAX_BYTES: 5 * 1024 * 1024,
  ALLOWED_MIME: ["image/jpeg", "image/png", "image/webp", "application/pdf"]
};

const TZ = "Asia/Jakarta";

const HEADERS = [
  "Timestamp", "No. Registrasi", "Nama Lengkap", "Jenis Kelamin", "Usia", "No. WhatsApp",
  "Domisili", "Metode Bayar", "Status Pembayaran", "Link Bukti Bayar", "Komitmen", "Catatan Admin"
];

// Nomor kolom (1-based), urutan TETAP sesuai architecture.md §5
const COL = {
  TIMESTAMP: 1, REGNO: 2, NAME: 3, GENDER: 4, AGE: 5, PHONE: 6,
  CITY: 7, METHOD: 8, STATUS: 9, PROOF: 10, COMMITMENT: 11, NOTE: 12
};

const GENDERS = ["Laki-laki", "Perempuan"];
const METHODS = ["QRIS", "Tunai"];
const STATUS = {
  WAITING: "Menunggu Verifikasi",
  CASH: "Belum Bayar (Bayar di Lokasi)",
  PAID: "Lunas",
  REJECTED: "Ditolak"
};
const EXT_BY_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf"
};

const MSG = {
  unreadable: "Data pendaftaran tidak terbaca. Silakan coba lagi.",
  required: function (label) { return label + " wajib diisi."; },
  minLen: function (label, n) { return label + " minimal " + n + " karakter."; },
  maxLen: function (label, n) { return label + " maksimal " + n + " karakter."; },
  badChars: function (label) { return label + " mengandung karakter yang tidak valid."; },
  age: "Usia harus berupa angka antara 5 dan 100.",
  whatsapp: "Nomor WhatsApp tidak valid. Contoh: 08123456789.",
  paymentMethod: "Pilih metode pembayaran.",
  proof: "Unggah bukti pembayaran terlebih dahulu.",
  fileType: "Format file harus JPG, PNG, WEBP, atau PDF.",
  fileSize: "Ukuran file maksimal 5 MB.",
  fileInvalid: "File bukti pembayaran tidak valid. Silakan unggah ulang.",
  commitment: "Centang pernyataan komitmen untuk melanjutkan.",
  duplicate: "Nomor WhatsApp ini sudah terdaftar.",
  quotaFull: "Mohon maaf, kuota pendaftaran sudah penuh.",
  busy: "Server sedang sibuk. Silakan coba lagi sebentar.",
  server: "Terjadi kendala di server. Silakan coba beberapa saat lagi atau hubungi admin."
};

// Karakter kontrol selain tab/LF/CR (whitespace dirapikan menjadi spasi)
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

class AppError extends Error {
  constructor(code, message, field) {
    super(message);
    this.code = code;
    this.field = field || null;
  }
}

/* ------------------------------------------------------------------------
   ENDPOINT
   ------------------------------------------------------------------------ */

/** GET: health check & info kuota. */
function doGet() {
  try {
    const registered = scanAll_(null).count;
    const quotaFull = CONFIG.QUOTA_MAX > 0 && registered >= CONFIG.QUOTA_MAX;
    return json_({
      success: true,
      data: { open: !quotaFull, registered: registered, quotaMax: CONFIG.QUOTA_MAX, quotaFull: quotaFull }
    });
  } catch (err) {
    console.error("doGet error:", err && err.stack ? err.stack : err);
    return json_({ success: false, code: "SERVER_ERROR", message: MSG.server });
  }
}

/** POST: pendaftaran. Body = string JSON (Content-Type text/plain). */
function doPost(e) {
  try {
    const body = parseBody_(e);

    // Honeypot: bot mengisi field tersembunyi → pura-pura sukses tanpa menyimpan
    if (typeof body.website === "string" && body.website.trim() !== "") {
      return json_(fakeSuccess_(body));
    }

    const input = validate_(body);
    return json_(register_(input));
  } catch (err) {
    if (err instanceof AppError) {
      const out = { success: false, code: err.code, message: err.message };
      if (err.field) out.field = err.field;
      return json_(out);
    }
    // Jangan bocorkan detail error ke klien
    console.error("doPost error:", err && err.stack ? err.stack : err);
    return json_({ success: false, code: "SERVER_ERROR", message: MSG.server });
  }
}

/* ------------------------------------------------------------------------
   PARSING & VALIDASI
   ------------------------------------------------------------------------ */
function parseBody_(e) {
  if (!e || !e.postData || typeof e.postData.contents !== "string" || !e.postData.contents) {
    throw new AppError("VALIDATION_ERROR", MSG.unreadable);
  }
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    throw new AppError("VALIDATION_ERROR", MSG.unreadable);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError("VALIDATION_ERROR", MSG.unreadable);
  }
  return body;
}

function validate_(b) {
  const name = cleanText_(b.name, "Nama Lengkap", 3, 100, "name");

  const gender = typeof b.gender === "string" ? b.gender : "";
  if (GENDERS.indexOf(gender) === -1) {
    throw new AppError("VALIDATION_ERROR", MSG.required("Jenis Kelamin"), "gender");
  }

  const age = parseAge_(b.age);
  if (age === null) throw new AppError("VALIDATION_ERROR", MSG.age, "age");

  const whatsapp = normalizeWhatsApp_(b.whatsapp);
  if (!whatsapp) throw new AppError("VALIDATION_ERROR", MSG.whatsapp, "whatsapp");

  const city = cleanText_(b.city, "Domisili", 2, 100, "city");

  const paymentMethod = typeof b.paymentMethod === "string" ? b.paymentMethod : "";
  if (METHODS.indexOf(paymentMethod) === -1) {
    throw new AppError("VALIDATION_ERROR", MSG.paymentMethod, "paymentMethod");
  }

  let proof = null;
  let commitment = false;
  if (paymentMethod === "QRIS") {
    proof = validateProof_(b.proof);          // commitment diabaikan
  } else {
    if (b.commitment !== true) {
      throw new AppError("COMMITMENT_REQUIRED", MSG.commitment, "commitment");
    }
    commitment = true;                        // proof diabaikan
  }

  return {
    name: name, gender: gender, age: age, whatsapp: whatsapp, city: city,
    paymentMethod: paymentMethod, commitment: commitment, proof: proof
  };
}

function cleanText_(value, label, min, max, field) {
  if (value === null || value === undefined || (typeof value !== "string" && typeof value !== "number")) {
    throw new AppError("VALIDATION_ERROR", MSG.required(label), field);
  }
  const raw = String(value);
  if (CONTROL_CHARS.test(raw)) throw new AppError("VALIDATION_ERROR", MSG.badChars(label), field);
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) throw new AppError("VALIDATION_ERROR", MSG.required(label), field);
  const len = Array.from(s).length;
  if (len < min) throw new AppError("VALIDATION_ERROR", MSG.minLen(label, min), field);
  if (len > max) throw new AppError("VALIDATION_ERROR", MSG.maxLen(label, max), field);
  return s;
}

function parseAge_(value) {
  let n = NaN;
  if (typeof value === "number") n = value;
  else if (typeof value === "string" && /^\s*\d{1,3}\s*$/.test(value)) n = parseInt(value, 10);
  return Number.isInteger(n) && n >= 5 && n <= 100 ? n : null;
}

/** "+62 812-3456-789" / "0812 3456 789" / "812..." → "62812..."; null jika tidak valid. */
function normalizeWhatsApp_(value) {
  if (value === null || value === undefined) return null;
  let d = String(value).replace(/\D/g, "");
  if (d.indexOf("0") === 0) d = "62" + d.slice(1);
  else if (d.indexOf("8") === 0) d = "62" + d;
  return /^628\d{8,12}$/.test(d) ? d : null;
}

function validateProof_(p) {
  if (!p || typeof p !== "object" || typeof p.base64 !== "string" || !p.base64) {
    throw new AppError("PROOF_REQUIRED", MSG.proof, "proof");
  }
  const mimeType = typeof p.mimeType === "string" ? p.mimeType.toLowerCase() : "";
  if (CONFIG.ALLOWED_MIME.indexOf(mimeType) === -1) {
    throw new AppError("FILE_INVALID", MSG.fileType, "proof");
  }

  const b64 = p.base64.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  const maxB64Len = Math.ceil(CONFIG.MAX_BYTES / 3) * 4;
  if (b64.length > maxB64Len) throw new AppError("FILE_INVALID", MSG.fileSize, "proof");
  if (b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
    throw new AppError("FILE_INVALID", MSG.fileInvalid, "proof");
  }

  let bytes;
  try {
    bytes = Utilities.base64Decode(b64);
  } catch (err) {
    throw new AppError("FILE_INVALID", MSG.fileInvalid, "proof");
  }
  if (!bytes || bytes.length === 0) throw new AppError("FILE_INVALID", MSG.fileInvalid, "proof");
  if (bytes.length > CONFIG.MAX_BYTES) throw new AppError("FILE_INVALID", MSG.fileSize, "proof");

  // Isi file harus cocok dengan MIME yang diklaim
  if (sniffMime_(bytes) !== mimeType) throw new AppError("FILE_INVALID", MSG.fileType, "proof");

  return { mimeType: mimeType, bytes: bytes };
}

/** Deteksi tipe file dari magic bytes. Byte Apps Script bertipe signed (-128..127). */
function sniffMime_(bytes) {
  const b = function (i) { return i < bytes.length ? (bytes[i] & 0xFF) : -1; };
  const ascii = function (from, to) {
    let s = "";
    for (let i = from; i < to; i++) s += String.fromCharCode(b(i));
    return s;
  };
  if (b(0) === 0xFF && b(1) === 0xD8 && b(2) === 0xFF) return "image/jpeg";
  if (b(0) === 0x89 && ascii(1, 4) === "PNG" && b(4) === 0x0D && b(5) === 0x0A && b(6) === 0x1A && b(7) === 0x0A) return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 4) === "%PDF") return "application/pdf";
  return null;
}

/* ------------------------------------------------------------------------
   PENYIMPANAN
   ------------------------------------------------------------------------ */
function register_(input) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new AppError("BUSY", MSG.busy);

  let file = null;
  try {
    // Kuota, duplikat WA, dan nomor registrasi dihitung GABUNGAN semua tab
    const scan = scanAll_(input.whatsapp);
    const sheet = getSheet_(CONFIG.SHEETS[input.gender]);

    if (CONFIG.QUOTA_MAX > 0 && scan.count >= CONFIG.QUOTA_MAX) {
      throw new AppError("QUOTA_FULL", MSG.quotaFull);
    }
    if (scan.duplicate) {
      throw new AppError("DUPLICATE_PHONE", MSG.duplicate, "whatsapp");
    }

    // Pakai nomor tertinggi + 1 (bukan sekadar jumlah baris) agar tidak bentrok
    // walau admin menghapus baris.
    const regNo = CONFIG.REG_PREFIX + "-" + String(scan.maxSeq + 1).padStart(4, "0");
    const now = new Date();
    const isQris = input.paymentMethod === "QRIS";
    const status = isQris ? STATUS.WAITING : STATUS.CASH;

    let proofUrl = "";
    if (isQris) {
      // Simpan file DI DALAM lock dan SEBELUM appendRow
      file = saveProof_(input, regNo, now);
      proofUrl = file.getUrl();
    }

    const row = [
      now,
      regNo,
      asText_(input.name),
      input.gender,
      input.age,
      asText_(input.whatsapp),
      asText_(input.city),
      input.paymentMethod,
      status,
      proofUrl,
      isQris ? asText_("-") : true,
      ""
    ];

    try {
      sheet.appendRow(row);
      SpreadsheetApp.flush();
    } catch (err) {
      // Jangan tinggalkan file yatim di Drive
      if (file) {
        try { file.setTrashed(true); } catch (e2) { console.error("Gagal men-trash file:", e2); }
      }
      throw err;
    }

    return {
      success: true,
      message: "Pendaftaran berhasil",
      data: { regNo: regNo, name: input.name, paymentMethod: input.paymentMethod, paymentStatus: status }
    };
  } finally {
    lock.releaseLock();
  }
}

/** Nama semua tab data: Putra, Putri, plus tab lama "Peserta" bila masih ada. */
function dataSheetNames_() {
  const names = Object.keys(CONFIG.SHEETS).map(function (g) { return CONFIG.SHEETS[g]; });
  if (CONFIG.LEGACY_SHEET && names.indexOf(CONFIG.LEGACY_SHEET) === -1) names.push(CONFIG.LEGACY_SHEET);
  return names;
}

/** Gabungkan hasil scan dari semua tab data yang ada. */
function scanAll_(phone) {
  const ss = spreadsheet_();
  const total = { count: 0, maxSeq: 0, duplicate: false };
  dataSheetNames_().forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const r = scanSheet_(sheet, phone);
    total.count += r.count;
    total.maxSeq = Math.max(total.maxSeq, r.maxSeq);
    total.duplicate = total.duplicate || r.duplicate;
  });
  return total;
}

/**
 * Baca kolom B..F satu tab sekaligus: hitung peserta, nomor registrasi tertinggi,
 * dan cek duplikat nomor WhatsApp.
 */
function scanSheet_(sheet, phone) {
  const lastRow = sheet.getLastRow();
  const result = { count: 0, maxSeq: 0, duplicate: false };
  if (lastRow < 2) return result;

  const width = COL.PHONE - COL.REGNO + 1;
  const values = sheet.getRange(2, COL.REGNO, lastRow - 1, width).getValues();
  const re = new RegExp("^" + CONFIG.REG_PREFIX + "-(\\d+)$");
  const phoneIdx = COL.PHONE - COL.REGNO;

  for (let i = 0; i < values.length; i++) {
    const reg = String(values[i][0] || "").trim();
    if (reg) {
      result.count++;
      const m = reg.match(re);
      if (m) result.maxSeq = Math.max(result.maxSeq, parseInt(m[1], 10));
    }
    if (phone && !result.duplicate) {
      const cell = String(values[i][phoneIdx] || "");
      const stored = normalizeWhatsApp_(cell) || cell.replace(/\D/g, "");
      if (stored && stored === phone) result.duplicate = true;
    }
  }
  return result;
}

function saveProof_(input, regNo, now) {
  const folderId = folderId_();
  if (!folderId) throw new Error("CONFIG.DRIVE_FOLDER_ID belum diisi");
  const folder = DriveApp.getFolderById(folderId);

  // Nama aman; ekstensi dari MIME tervalidasi, bukan dari input
  const safeName = input.name
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40) || "peserta";
  const stamp = Utilities.formatDate(now, TZ, "yyyyMMddHHmmss");
  const fileName = regNo + "_" + safeName + "_" + stamp + "." + EXT_BY_MIME[input.proof.mimeType];

  const blob = Utilities.newBlob(input.proof.bytes, input.proof.mimeType, fileName);
  // File baru mewarisi akses folder; folder WAJIB privat (dicek di setup()).
  return folder.createFile(blob);
}

/**
 * Paksa nilai ditulis sebagai teks biasa. Awalan apostrof tidak tampil di sel,
 * mencegah formula injection (=, +, -, @, tab, CR) dan konversi otomatis
 * (mis. nomor WA menjadi angka, "1/2" menjadi tanggal).
 */
function asText_(value) {
  return "'" + String(value);
}

/**
 * Ambil ID folder bersih dari CONFIG.DRIVE_FOLDER_ID. Menerima ID saja,
 * ID + "?hl=ID", atau URL lengkap "https://drive.google.com/drive/folders/<ID>?...".
 */
function folderId_() {
  const raw = String(CONFIG.DRIVE_FOLDER_ID || "").trim();
  const fromUrl = raw.match(/folders\/([A-Za-z0-9_-]+)/) || raw.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (fromUrl) return fromUrl[1];
  return raw.split(/[?#&\/\s]/)[0];
}

function spreadsheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Script harus terikat (bound) ke Google Spreadsheet.");
  return ss;
}

/** Ambil tab berdasarkan nama; buat lengkap dengan header bila belum ada. */
function getSheet_(name) {
  const ss = spreadsheet_();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fakeSuccess_(body) {
  const method = METHODS.indexOf(body.paymentMethod) !== -1 ? body.paymentMethod : "Tunai";
  const seq = Math.floor(1000 + Math.random() * 9000);
  return {
    success: true,
    message: "Pendaftaran berhasil",
    data: {
      regNo: CONFIG.REG_PREFIX + "-" + seq,
      name: String(body.name || "").slice(0, 100),
      paymentMethod: method,
      paymentStatus: method === "QRIS" ? STATUS.WAITING : STATUS.CASH
    }
  };
}

/* ------------------------------------------------------------------------
   SETUP (jalankan SEKALI dari editor Apps Script)
   ------------------------------------------------------------------------ */
function setup() {
  const ss = spreadsheet_();
  ss.setSpreadsheetTimeZone(TZ);

  // Tab Putra & Putri
  const names = Object.keys(CONFIG.SHEETS).map(function (g) { return CONFIG.SHEETS[g]; });
  names.forEach(function (name, i) {
    const sheet = getSheet_(name);
    formatSheet_(sheet);
    if (CONFIG.TAB_COLORS[name]) sheet.setTabColor(CONFIG.TAB_COLORS[name]);
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(i + 1);
    console.log("Tab '" + name + "' siap.");
  });

  // Tab lama "Peserta": hapus bila hanya berisi header; bila ada data, biarkan
  const legacy = CONFIG.LEGACY_SHEET && ss.getSheetByName(CONFIG.LEGACY_SHEET);
  if (legacy && names.indexOf(CONFIG.LEGACY_SHEET) === -1) {
    if (legacy.getLastRow() <= 1) {
      ss.deleteSheet(legacy);
      console.log("Tab lama '" + CONFIG.LEGACY_SHEET + "' (kosong) dihapus.");
    } else {
      console.warn("⚠️ Tab lama '" + CONFIG.LEGACY_SHEET + "' berisi data, tidak dihapus. " +
        "Pindahkan barisnya ke tab Putra/Putri secara manual bila perlu.");
    }
  }

  // Tab bawaan yang benar-benar kosong (Sheet1 / Lembar1) dihapus agar rapi
  ["Sheet1", "Lembar1", "Lembar 1"].forEach(function (n) {
    const s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && s.getLastColumn() === 0 && ss.getSheets().length > 1) {
      ss.deleteSheet(s);
      console.log("Tab kosong '" + n + "' dihapus.");
    }
  });

  checkDriveFolder_();
  console.log("Setup selesai.");
}

/** Header, format, dropdown status, dan warna status untuk satu tab. */
function formatSheet_(sheet) {
  sheet.getRange(1, 1, 1, HEADERS.length)
    .setValues([HEADERS])
    .setFontWeight("bold")
    .setBackground("#0A3D2E")
    .setFontColor("#FFFFFF");
  sheet.setFrozenRows(1);

  const rows = Math.max(sheet.getMaxRows() - 1, 1);
  sheet.getRange(2, COL.TIMESTAMP, rows, 1).setNumberFormat("dd/MM/yyyy HH:mm:ss");
  sheet.getRange(2, COL.PHONE, rows, 1).setNumberFormat("@");

  // Dropdown status pembayaran
  const statusRange = sheet.getRange(2, COL.STATUS, rows, 1);
  statusRange.setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList([STATUS.WAITING, STATUS.CASH, STATUS.PAID, STATUS.REJECTED], true)
      .setAllowInvalid(false)
      .build()
  );

  // Warna per status (aturan lama untuk kolom status diganti)
  const colors = [
    [STATUS.WAITING, "#FFF7E0", "#7A5200"],
    [STATUS.CASH, "#EEEFEE", "#3C4340"],
    [STATUS.PAID, "#ECFDF3", "#15803D"],
    [STATUS.REJECTED, "#FEF2F2", "#B91C1C"]
  ];
  const rules = sheet.getConditionalFormatRules().filter(function (rule) {
    return !rule.getRanges().some(function (r) { return r.getColumn() === COL.STATUS; });
  });
  colors.forEach(function (c) {
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo(c[0])
        .setBackground(c[1])
        .setFontColor(c[2])
        .setRanges([statusRange])
        .build()
    );
  });
  sheet.setConditionalFormatRules(rules);

  const widths = [150, 110, 200, 110, 60, 140, 160, 100, 200, 220, 90, 220];
  widths.forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
}

function checkDriveFolder_() {
  const folderId = folderId_();
  if (!folderId) {
    console.warn("⚠️ CONFIG.DRIVE_FOLDER_ID belum diisi. Pendaftaran QRIS akan gagal sampai diisi.");
  } else {
    let folder;
    try {
      folder = DriveApp.getFolderById(folderId);
      folder.getName();
    } catch (err) {
      throw new Error(
        "Folder Drive dengan ID '" + folderId + "' tidak ditemukan atau tidak bisa diakses akun ini. " +
        "Salin ID dari URL folder: drive.google.com/drive/folders/<ID> (tanpa '?hl=...')."
      );
    }
    const access = folder.getSharingAccess();
    if (access !== DriveApp.Access.PRIVATE) {
      console.warn("⚠️ Folder '" + folder.getName() + "' TIDAK privat (" + access + "). Ubah berbagi folder menjadi 'Dibatasi'.");
    } else {
      console.log("Folder bukti bayar OK & privat: " + folder.getName());
    }
  }
}

/* ------------------------------------------------------------------------
   UJI MANUAL (opsional). ⚠️ Menulis baris uji ke Sheet & file ke Drive.
   Hapus baris/file uji setelah selesai.
   ------------------------------------------------------------------------ */
function testSubmit() {
  // PNG 1x1 piksel
  const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const base = { gender: "Laki-laki", age: 25, city: "Surakarta" };
  const cases = [
    ["AT-01 QRIS + bukti", Object.assign({}, base, { name: "Uji QRIS", whatsapp: "0812 0000 0001", paymentMethod: "QRIS", proof: { fileName: "a.png", mimeType: "image/png", base64: tinyPng } })],
    ["AT-02 QRIS tanpa bukti", Object.assign({}, base, { name: "Uji Tanpa Bukti", whatsapp: "081200000002", paymentMethod: "QRIS" })],
    ["AT-03 Tunai tanpa komitmen", Object.assign({}, base, { name: "Uji Tunai", whatsapp: "081200000003", paymentMethod: "Tunai", commitment: false })],
    ["AT-04 Tunai + komitmen", Object.assign({}, base, { name: "Uji Tunai OK", whatsapp: "+62 812-0000-0004", paymentMethod: "Tunai", commitment: true })],
    ["AT-05 MIME palsu", Object.assign({}, base, { name: "Uji MIME", whatsapp: "081200000005", paymentMethod: "QRIS", proof: { fileName: "a.pdf", mimeType: "application/pdf", base64: tinyPng } })],
    ["Putri → tab Putri", Object.assign({}, base, { name: "Uji Putri", gender: "Perempuan", whatsapp: "081200000007", paymentMethod: "Tunai", commitment: true })],
    ["AT-06 Duplikat lintas tab", Object.assign({}, base, { name: "Uji Duplikat", gender: "Perempuan", whatsapp: "6281200000004", paymentMethod: "Tunai", commitment: true })],
    ["AT-08 Formula", Object.assign({}, base, { name: "=HYPERLINK(\"http://x\")", whatsapp: "081200000008", paymentMethod: "Tunai", commitment: true })]
  ];
  cases.forEach(function (c) {
    const out = doPost({ postData: { contents: JSON.stringify(c[1]), type: "text/plain" } });
    console.log(c[0] + " → " + out.getContent());
  });
}
