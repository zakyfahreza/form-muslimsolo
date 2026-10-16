/* ==========================================================================
   Daurah "Tajidul Iman" - Muslim Solo
   Frontend vanilla JS (tanpa framework / build step).
   Validasi di sini hanya untuk UX; server (Apps Script) adalah otoritas akhir.
   ========================================================================== */
"use strict";

/* --------------------------------------------------------------------------
   KONFIGURASI (ubah nilai di sini saja)
   -------------------------------------------------------------------------- */
const CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycby72vRg1AY0vxzNrQt-uDii4w0O4aUaSaWkP6egeQAL3qvTqjOoNDuIJsKRtoeLWmsurg/exec",                      // ⚠️ URL Web App Apps Script (…/exec)
  EVENT: {
    SERIES: "Daurah Safr Ilmu (Ikhwan & Akhwat)",
    TITLE: "Tajidul Iman",
    SPEAKER: "Ustadz Afifi Abdul Wadud, B.A",
    DATE_LABEL: "Ahad, 25 Oktober 2026",   // dikonfirmasi pemilik (prd.md OQ-1)
    HIJRI_LABEL: "14 Jumadil Awal 1448",
    TIME_LABEL: "Pukul 08.00 WIB s.d. Selesai",
    VENUE: "Masjid Ar Rahman, Surakarta",
    ADDRESS: "Jl. Babar Layar No.3, Danukusuman",
    MAPS_URL: "https://share.google/hAcQMj9ijkJnuqtQK",
    FEE: 20000,
    BENEFITS: ["Ilmu & Ukhuwwah", "Snack & Makan Siang"],
    BRING: "Alas (sajadah) & alat tulis"
  },
  ADMIN_WA: "6281935252800",        // 0819-3525-2800
  DONATION_URL: "https://donasi.muslimsolo.id",
  QRIS_IMAGE: "assets/qris_ms.jpeg",
  FILE: { MAX_BYTES: 5 * 1024 * 1024, TYPES: ["image/jpeg", "image/png", "image/webp", "application/pdf"], IMG_MAX_PX: 1600, IMG_QUALITY: 0.8 },
  REG_PREFIX: "TJI"
};

const SUBMIT_TIMEOUT_MS = 60000;
const QUOTA_TIMEOUT_MS = 10000;

/* --------------------------------------------------------------------------
   Mikrokopi (design.md §6)
   -------------------------------------------------------------------------- */
const LABELS = {
  name: "Nama Lengkap",
  gender: "Jenis Kelamin",
  age: "Usia",
  whatsapp: "Nomor WhatsApp",
  city: "Domisili"
};

const MSG = {
  required: (label) => `${label} wajib diisi.`,
  minLen: (label, n) => `${label} minimal ${n} karakter.`,
  maxLen: (label, n) => `${label} maksimal ${n} karakter.`,
  badChars: (label) => `${label} mengandung karakter yang tidak valid.`,
  age: "Usia harus berupa angka antara 5 dan 100.",
  whatsapp: "Nomor WhatsApp tidak valid. Contoh: 08123456789.",
  paymentMethod: "Pilih metode pembayaran.",
  proof: "Unggah bukti pembayaran terlebih dahulu.",
  proofProcessing: "Tunggu sebentar, bukti pembayaran masih diproses.",
  fileSize: "Ukuran file maksimal 5 MB.",
  fileType: "Format file harus JPG, PNG, WEBP, atau PDF.",
  fileUnreadable: "File tidak dapat diproses. Silakan pilih file lain.",
  commitment: "Centang pernyataan komitmen untuk melanjutkan.",
  duplicate: "Nomor WhatsApp ini sudah terdaftar.",
  duplicateHint: "Jika Anda baru saja mendaftar, hubungi admin untuk menanyakan No. Registrasi Anda.",
  network: "Koneksi bermasalah. Data Anda masih tersimpan di form, silakan coba lagi.",
  server: "Terjadi kendala di server. Silakan coba beberapa saat lagi atau hubungi admin.",
  busy: "Server sedang sibuk. Silakan tekan tombol Daftar sekali lagi.",
  checkFields: "Mohon periksa kembali isian yang ditandai.",
  notConfigured: "Formulir belum terhubung ke server. Silakan hubungi admin."
};

const FIELD_ORDER = ["name", "gender", "age", "whatsapp", "city", "paymentMethod", "proof", "commitment"];
const GENDERS = ["Laki-laki", "Perempuan"];
const METHODS = ["QRIS", "Tunai"];
// Karakter kontrol selain tab/LF/CR (whitespace itu dirapikan menjadi spasi)
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/* --------------------------------------------------------------------------
   State (objek tunggal, architecture.md §9.1)
   -------------------------------------------------------------------------- */
const state = {
  values: { name: "", gender: "", age: "", whatsapp: "", city: "", paymentMethod: "", commitment: false },
  proof: null,          // { fileName, mimeType, base64, previewUrl, size, displayName }
  errors: {},
  submitting: false,
  quotaFull: false,
  processingProof: false
};

let proofToken = 0;     // membatalkan hasil kompresi yang sudah usang
let lastRegNo = "";

/* --------------------------------------------------------------------------
   Utilitas
   -------------------------------------------------------------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const prefersReducedMotion = () =>
  window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function formatRupiah(n) {
  return "Rp" + new Intl.NumberFormat("id-ID").format(n);
}

/** 6281935252800 → 0819-3525-2800 */
function formatPhoneDisplay(intl) {
  const local = "0" + String(intl).replace(/^62/, "");
  return [local.slice(0, 4), local.slice(4, 8), local.slice(8)].filter(Boolean).join("-");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

function waLink(text) {
  return `https://wa.me/${CONFIG.ADMIN_WA}?text=${encodeURIComponent(text)}`;
}

function lowerFirst(s) {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function scrollToEl(el, block = "start") {
  if (!el) return;
  el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block });
}

/* --------------------------------------------------------------------------
   Normalisasi & validasi (aturan prd.md §6.2-6.3)
   -------------------------------------------------------------------------- */
function cleanText(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function charLength(s) {
  return Array.from(s).length;
}

/** "+62 812-3456-789" / "0812 3456 789" / "812..." → "62812..."; null jika tidak valid */
function normalizeWhatsApp(value) {
  let d = String(value == null ? "" : value).replace(/\D/g, "");
  if (d.startsWith("0")) d = "62" + d.slice(1);
  else if (d.startsWith("8")) d = "62" + d;
  return /^628\d{8,12}$/.test(d) ? d : null;
}

function parseAge(value) {
  const s = String(value == null ? "" : value).trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n >= 5 && n <= 100 ? n : null;
}

function validateText(raw, label, min, max) {
  if (CONTROL_CHARS.test(String(raw))) return MSG.badChars(label);
  const s = cleanText(raw);
  if (!s) return MSG.required(label);
  const len = charLength(s);
  if (len < min) return MSG.minLen(label, min);
  if (len > max) return MSG.maxLen(label, max);
  return "";
}

function validateField(field) {
  const v = state.values;
  switch (field) {
    case "name":
      return validateText(v.name, LABELS.name, 3, 100);
    case "gender":
      return GENDERS.includes(v.gender) ? "" : MSG.required(LABELS.gender);
    case "age":
      if (!String(v.age).trim()) return MSG.required(LABELS.age);
      return parseAge(v.age) === null ? MSG.age : "";
    case "whatsapp":
      if (!String(v.whatsapp).trim()) return MSG.required(LABELS.whatsapp);
      return normalizeWhatsApp(v.whatsapp) ? "" : MSG.whatsapp;
    case "city":
      return validateText(v.city, LABELS.city, 2, 100);
    case "paymentMethod":
      return METHODS.includes(v.paymentMethod) ? "" : MSG.paymentMethod;
    case "proof":
      if (v.paymentMethod !== "QRIS") return "";
      if (state.processingProof) return MSG.proofProcessing;
      return state.proof ? "" : MSG.proof;
    case "commitment":
      if (v.paymentMethod !== "Tunai") return "";
      return v.commitment === true ? "" : MSG.commitment;
    default:
      return "";
  }
}

/* --------------------------------------------------------------------------
   Render error
   -------------------------------------------------------------------------- */
function fieldInputs(field) {
  switch (field) {
    case "gender": return $$('input[name="gender"]');
    case "paymentMethod": return $$('input[name="paymentMethod"]');
    default: {
      const el = document.getElementById(field);
      return el ? [el] : [];
    }
  }
}

function setError(field, message) {
  const container = document.getElementById(`field-${field}`);
  const errEl = document.getElementById(`err-${field}`);
  if (message) state.errors[field] = message;
  else delete state.errors[field];

  if (errEl) {
    errEl.replaceChildren();
    if (message) {
      const svgNS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(svgNS, "svg");
      svg.setAttribute("class", "icon");
      svg.setAttribute("aria-hidden", "true");
      const use = document.createElementNS(svgNS, "use");
      use.setAttribute("href", "#i-warn");
      svg.appendChild(use);
      const span = document.createElement("span");
      span.textContent = message;
      errEl.append(svg, span);
    }
  }
  if (container) container.classList.toggle("field--error", Boolean(message));
  fieldInputs(field).forEach((input) => {
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  });
}

function clearAllErrors() {
  FIELD_ORDER.forEach((f) => setError(f, ""));
}

function showAlert(message) {
  $("#form-alert-text").textContent = message;
  $("#form-alert").hidden = false;
}

function hideAlert() {
  $("#form-alert").hidden = true;
  $("#form-alert-text").textContent = "";
}

function focusField(field) {
  const container = document.getElementById(`field-${field}`);
  let target;
  if (field === "gender" || field === "paymentMethod") {
    const inputs = fieldInputs(field);
    target = inputs.find((i) => i.checked) || inputs[0];
  } else if (field === "proof") {
    target = state.proof ? $("#proof-change") : $("#proof");
  } else {
    target = document.getElementById(field);
  }
  scrollToEl(container, "center");
  if (target) target.focus({ preventScroll: true });
}

/* --------------------------------------------------------------------------
   Data acara dari CONFIG (FR-02)
   -------------------------------------------------------------------------- */
function bindEventInfo() {
  const ev = CONFIG.EVENT;
  const fee = formatRupiah(ev.FEE);
  const hasDate = Boolean(ev.DATE_LABEL && ev.DATE_LABEL.trim());
  const date = hasDate ? ev.DATE_LABEL : "Tanggal segera diumumkan";
  const hijri = hasDate && ev.HIJRI_LABEL ? ev.HIJRI_LABEL : "";

  if (!hasDate) {
    console.warn("[CONFIG] EVENT.DATE_LABEL belum diisi. Lihat prd.md OQ-1.");
  }

  const values = {
    series: ev.SERIES,
    title: `${ev.TITLE}.`,
    badge: `Kontribusi ${fee} | Kuota Terbatas`,
    speakerName: ev.SPEAKER.replace(/^Ustadz\s+/i, ""),
    date,
    hijri,
    dateFull: hijri ? `${date} / ${hijri}` : date,
    time: ev.TIME_LABEL,
    venue: ev.VENUE,
    address: ev.ADDRESS,
    venueFull: `${ev.VENUE} (${ev.ADDRESS})`,
    benefits: ev.BENEFITS.join(" • "),
    bringLine: `Diharapkan membawa ${lowerFirst(ev.BRING)}`,
    bringReminder: `Bawa ${lowerFirst(ev.BRING)}`,
    fee,
    adminPhone: formatPhoneDisplay(CONFIG.ADMIN_WA)
  };

  $$("[data-bind]").forEach((el) => {
    const key = el.dataset.bind;
    if (!(key in values)) return;
    el.textContent = values[key];
    if (!values[key]) el.hidden = true;
  });

  document.title = `Pendaftaran Daurah ${ev.TITLE} | Muslim Solo`;

  $("#footer-wa").href = waLink(`Assalamu'alaikum admin, saya ingin bertanya seputar daurah ${ev.TITLE}.`);
  $("#donation-link").href = CONFIG.DONATION_URL;
  $("#maps-link").href = ev.MAPS_URL;
  $("#maps-link").hidden = !ev.MAPS_URL;
  $("#quota-wa-btn").href = waLink(`Assalamu'alaikum admin, saya ingin masuk daftar tunggu daurah ${ev.TITLE}.`);

  // Gambar QRIS
  const img = $("#qris-img");
  const download = $("#qris-download");
  img.alt = `Kode QRIS untuk pembayaran kontribusi daurah ${ev.TITLE} sebesar ${fee}`;
  img.addEventListener("error", () => {
    img.hidden = true;
    download.hidden = true;
    $("#qris-missing").hidden = false;
    console.warn(`[CONFIG] Gambar QRIS tidak ditemukan di ${CONFIG.QRIS_IMAGE}. Lihat prd.md OQ-2.`);
  }, { once: true });
  img.src = CONFIG.QRIS_IMAGE;
  download.href = CONFIG.QRIS_IMAGE;
  download.addEventListener("click", downloadQris);
}

/**
 * Unduh QRIS langsung ke folder Download. Atribut `download` saja sering
 * diabaikan browser HP (gambar malah dibuka), jadi file diambil sebagai Blob
 * lalu diunduh lewat object URL.
 */
async function downloadQris(event) {
  event.preventDefault();
  const link = event.currentTarget;
  const status = $("#qris-download-status");
  const fileName = link.getAttribute("download") || "QRIS.jpeg";
  status.textContent = "";
  try {
    const res = await fetch(CONFIG.QRIS_IMAGE, { cache: "force-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    status.textContent = "QRIS sudah diunduh. Cek folder Download atau Galeri Anda.";
  } catch (err) {
    // Fallback: buka gambar agar tetap bisa disimpan manual (tekan lama → Simpan)
    console.warn("Unduh QRIS gagal, membuka gambar:", err);
    window.open(CONFIG.QRIS_IMAGE, "_blank", "noopener");
    status.textContent = "Jika gambar terbuka, tekan lama gambar lalu pilih Simpan.";
  }
}

/* --------------------------------------------------------------------------
   Metode pembayaran (FR-20..25)
   -------------------------------------------------------------------------- */
function setPaymentMethod(method) {
  state.values.paymentMethod = method;
  setError("paymentMethod", "");
  const isQris = method === "QRIS";
  const isCash = method === "Tunai";

  $("#qris-block").hidden = !isQris;
  $("#cash-block").hidden = !isCash;

  if (!isCash) {
    // Bersihkan state Tunai
    state.values.commitment = false;
    $("#commitment").checked = false;
    setError("commitment", "");
  }
  if (!isQris) {
    // Bersihkan state QRIS
    clearProof();
    setError("proof", "");
  }
}

/* --------------------------------------------------------------------------
   Bukti pembayaran: deteksi tipe, kompresi, preview
   -------------------------------------------------------------------------- */
async function sniffMime(blob) {
  const buf = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const ascii = (from, to) => String.fromCharCode(...buf.slice(from, to));
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return "image/jpeg";
  if (buf[0] === 0x89 && ascii(1, 4) === "PNG" && buf[4] === 0x0D && buf[5] === 0x0A) return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 4) === "%PDF") return "application/pdf";
  return null;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Gambar tidak dapat dibaca"));
    img.src = url;
  });
}

/** Kecilkan sisi terpanjang ke IMG_MAX_PX lalu encode JPEG (latar putih untuk PNG transparan). */
async function compressImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new Error("Ukuran gambar tidak valid");
    const scale = Math.min(1, CONFIG.FILE.IMG_MAX_PX / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Kompresi gagal"))),
        "image/jpeg",
        CONFIG.FILE.IMG_QUALITY
      );
    });
    canvas.width = 0;
    canvas.height = 0;
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : "");
    };
    reader.onerror = () => reject(reader.error || new Error("Gagal membaca file"));
    reader.readAsDataURL(blob);
  });
}

function safeBaseName(name) {
  const base = String(name || "").replace(/\.[^.]*$/, "");
  return base.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 50) || "bukti";
}

function setProcessing(on) {
  state.processingProof = on;
  $("#proof-processing").hidden = !on;
  $("#upload-zone").hidden = on || Boolean(state.proof);
}

function clearProof() {
  proofToken++;
  if (state.proof && state.proof.previewUrl) URL.revokeObjectURL(state.proof.previewUrl);
  state.proof = null;
  state.processingProof = false;

  const input = $("#proof");
  input.value = "";
  const thumb = $("#proof-thumb");
  thumb.removeAttribute("src");
  thumb.hidden = true;
  $("#proof-pdf").hidden = true;
  $("#proof-name").textContent = "";
  $("#proof-size").textContent = "";
  $("#proof-preview").hidden = true;
  $("#proof-processing").hidden = true;
  $("#upload-zone").hidden = false;
}

function renderProof() {
  const p = state.proof;
  if (!p) return;
  const thumb = $("#proof-thumb");
  if (p.previewUrl) {
    thumb.src = p.previewUrl;
    thumb.hidden = false;
    $("#proof-pdf").hidden = true;
  } else {
    thumb.removeAttribute("src");
    thumb.hidden = true;
    $("#proof-pdf").hidden = false;
  }
  $("#proof-name").textContent = p.displayName;
  $("#proof-size").textContent = formatBytes(p.size);
  $("#upload-zone").hidden = true;
  $("#proof-preview").hidden = false;
}

async function handleFile(file) {
  clearProof();
  setError("proof", "");
  if (!file) return;

  const token = proofToken;
  const types = CONFIG.FILE.TYPES;

  // Tipe yang dilaporkan browser (boleh kosong di sebagian Android)
  if (file.type && !types.includes(file.type)) {
    setError("proof", MSG.fileType);
    return;
  }

  setProcessing(true);
  try {
    // Cek isi file sebenarnya (bukan hanya ekstensi)
    const sniffed = await sniffMime(file);
    if (token !== proofToken) return;
    if (!sniffed || !types.includes(sniffed)) {
      setError("proof", MSG.fileType);
      return;
    }

    let blob;
    let mimeType;
    let ext;
    if (sniffed === "application/pdf") {
      blob = file;               // PDF tidak dikompres
      mimeType = "application/pdf";
      ext = "pdf";
    } else {
      blob = await compressImage(file);
      mimeType = "image/jpeg";
      ext = "jpg";
    }
    if (token !== proofToken) return;

    if (blob.size > CONFIG.FILE.MAX_BYTES) {
      setError("proof", MSG.fileSize);
      return;
    }

    const base64 = await blobToBase64(blob);
    if (token !== proofToken) return;

    state.proof = {
      fileName: `${safeBaseName(file.name)}.${ext}`,
      mimeType,
      base64,
      previewUrl: mimeType.startsWith("image/") ? URL.createObjectURL(blob) : null,
      size: blob.size,
      displayName: file.name || `bukti.${ext}`
    };
    renderProof();
  } catch (err) {
    console.error("Gagal memproses bukti:", err);
    if (token === proofToken) setError("proof", MSG.fileUnreadable);
  } finally {
    if (token === proofToken) {
      setProcessing(false);
      $("#proof").value = "";   // agar memilih file yang sama tetap memicu "change"
    }
  }
}

/* --------------------------------------------------------------------------
   Kirim data
   -------------------------------------------------------------------------- */
class NetworkError extends Error {}

function syncValuesFromDom() {
  const form = $("#reg-form");
  const fd = new FormData(form);
  state.values.name = String(fd.get("name") || "");
  state.values.age = String(fd.get("age") || "");
  state.values.whatsapp = String(fd.get("whatsapp") || "");
  state.values.city = String(fd.get("city") || "");
  state.values.gender = String(fd.get("gender") || "");
  state.values.paymentMethod = String(fd.get("paymentMethod") || "");
  state.values.commitment = $("#commitment").checked;
}

function validateAll() {
  let first = null;
  FIELD_ORDER.forEach((field) => {
    const msg = validateField(field);
    setError(field, msg);
    if (msg && !first) first = field;
  });
  return first;
}

function buildPayload() {
  const v = state.values;
  const isQris = v.paymentMethod === "QRIS";
  return {
    name: cleanText(v.name),
    gender: v.gender,
    age: parseAge(v.age),
    whatsapp: normalizeWhatsApp(v.whatsapp),
    city: cleanText(v.city),
    paymentMethod: v.paymentMethod,
    commitment: v.paymentMethod === "Tunai" ? v.commitment === true : false,
    proof: isQris && state.proof
      ? { fileName: state.proof.fileName, mimeType: state.proof.mimeType, base64: state.proof.base64 }
      : null,
    website: $("#website").value   // honeypot
  };
}

async function fetchJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { ...options, signal: controller.signal, redirect: "follow" });
  } catch (err) {
    throw new NetworkError(err && err.message);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Respons bukan JSON (HTTP ${res.status})`);
  }
}

function setSubmitting(on) {
  state.submitting = on;
  const btn = $("#submit-btn");
  btn.disabled = on || state.quotaFull;
  btn.setAttribute("aria-busy", on ? "true" : "false");
  $("#submit-spinner").hidden = !on;
  $("#submit-label").textContent = on ? "Mengirim data…" : "Daftar";
}

async function handleSubmit(event) {
  event.preventDefault();
  if (state.submitting || state.quotaFull) return;

  hideAlert();
  syncValuesFromDom();

  const firstError = validateAll();
  if (firstError) {
    showAlert(MSG.checkFields);
    focusField(firstError);
    return;
  }

  if (!CONFIG.API_URL) {
    console.warn("[CONFIG] API_URL belum diisi.");
    showAlert(MSG.notConfigured);
    return;
  }

  const payload = buildPayload();
  setSubmitting(true);
  try {
    const res = await fetchJson(CONFIG.API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    }, SUBMIT_TIMEOUT_MS);

    if (res && res.success && res.data) {
      showSuccess(res.data, payload);
    } else {
      handleServerError(res || {});
    }
  } catch (err) {
    console.error("Gagal mengirim:", err);
    showAlert(err instanceof NetworkError ? MSG.network : MSG.server);
    scrollToEl($("#form-alert"), "center");
  } finally {
    setSubmitting(false);
  }
}

function handleServerError(res) {
  const code = res.code;
  if (code === "QUOTA_FULL") {
    showQuotaFull();
    return;
  }
  const field = FIELD_ORDER.includes(res.field) ? res.field : null;
  const message = res.message || MSG.server;

  if (field) {
    setError(field, code === "DUPLICATE_PHONE" ? MSG.duplicate : message);
    showAlert(code === "DUPLICATE_PHONE" ? `${MSG.duplicate} ${MSG.duplicateHint}` : MSG.checkFields);
    focusField(field);
    return;
  }

  showAlert(code === "BUSY" ? MSG.busy : MSG.server);
  scrollToEl($("#form-alert"), "center");
}

/* --------------------------------------------------------------------------
   Panel sukses (FR-31, FR-32) - render dengan textContent (anti-XSS)
   -------------------------------------------------------------------------- */
function showSuccess(data, payload) {
  const regNo = String(data.regNo || "");
  const name = String(data.name || payload.name);
  const method = String(data.paymentMethod || payload.paymentMethod);
  const status = String(data.paymentStatus || "");
  lastRegNo = regNo;

  $("#s-regno").textContent = regNo;
  $("#s-name").textContent = name;
  $("#s-gender").textContent = payload.gender;
  $("#s-age").textContent = `${payload.age} tahun`;
  $("#s-whatsapp").textContent = "0" + payload.whatsapp.slice(2);
  $("#s-city").textContent = payload.city;
  $("#s-method").textContent = method;

  const badge = $("#s-status");
  badge.textContent = status;
  badge.classList.remove("status-badge--waiting", "status-badge--cash");
  badge.classList.add(method === "QRIS" ? "status-badge--waiting" : "status-badge--cash");

  $("#wa-btn").href = waLink(
    `Assalamu'alaikum admin, saya sudah mendaftar daurah ${CONFIG.EVENT.TITLE}.\n` +
    `No. Registrasi: ${regNo}\n` +
    `Nama: ${name}`
  );

  // Bebaskan memori bukti bayar
  clearProof();

  $("#copy-btn").textContent = "Salin";
  $("#copy-status").textContent = "";
  $("#form-view").hidden = true;
  $("#quota-view").hidden = true;
  $("#success-view").hidden = false;

  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  $("#success-title").focus({ preventScroll: true });
}

async function copyRegNo() {
  const btn = $("#copy-btn");
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(lastRegNo);
      ok = true;
    }
  } catch { /* lanjut ke fallback */ }

  if (!ok) {
    const ta = document.createElement("textarea");
    ta.value = lastRegNo;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
  }

  btn.textContent = ok ? "Tersalin ✓" : "Gagal menyalin";
  $("#copy-status").textContent = ok ? "Nomor registrasi tersalin." : "Gagal menyalin, silakan catat manual.";
  setTimeout(() => { btn.textContent = "Salin"; }, 2000);
}

function resetForm() {
  $("#reg-form").reset();
  state.values = { name: "", gender: "", age: "", whatsapp: "", city: "", paymentMethod: "", commitment: false };
  clearProof();
  clearAllErrors();
  hideAlert();
  $("#qris-block").hidden = true;
  $("#cash-block").hidden = true;
  $("#success-view").hidden = true;

  if (state.quotaFull) {
    showQuotaFull();
    return;
  }
  $("#form-view").hidden = false;
  scrollToEl($("#form-card"));
  $("#name").focus({ preventScroll: true });
  checkQuota();
}

/* --------------------------------------------------------------------------
   Kuota (FR-35) - fail-open
   -------------------------------------------------------------------------- */
function showQuotaFull() {
  state.quotaFull = true;
  $("#submit-btn").disabled = true;
  $("#form-view").hidden = true;
  if ($("#success-view").hidden) {
    $("#quota-view").hidden = false;
  }
}

async function checkQuota() {
  if (!CONFIG.API_URL) return;
  try {
    const res = await fetchJson(CONFIG.API_URL, { method: "GET" }, QUOTA_TIMEOUT_MS);
    if (res && res.success && res.data && res.data.quotaFull === true && !state.submitting) {
      showQuotaFull();
    }
  } catch (err) {
    // Fail-open: kegagalan cek kuota tidak memblokir form
    console.warn("Cek kuota gagal (form tetap dibuka):", err);
  }
}

/* --------------------------------------------------------------------------
   Event listener
   -------------------------------------------------------------------------- */
function bindEvents() {
  const form = $("#reg-form");

  // Field teks: perbarui state; validasi ulang hanya jika sedang error,
  // dan validasi saat blur bila sudah ada isinya.
  ["name", "age", "whatsapp", "city"].forEach((field) => {
    const input = document.getElementById(field);
    input.addEventListener("input", () => {
      state.values[field] = input.value;
      if (state.errors[field]) setError(field, validateField(field));
    });
    input.addEventListener("blur", () => {
      state.values[field] = input.value;
      if (input.value.trim()) setError(field, validateField(field));
    });
  });

  $$('input[name="gender"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      state.values.gender = radio.value;
      setError("gender", "");
    });
  });

  $$('input[name="paymentMethod"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.checked) setPaymentMethod(radio.value);
    });
  });

  $("#proof").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleFile(file);
  });
  $("#proof-change").addEventListener("click", () => $("#proof").click());
  $("#proof-remove").addEventListener("click", () => {
    clearProof();
    $("#proof").focus();
  });

  $("#commitment").addEventListener("change", (e) => {
    state.values.commitment = e.target.checked;
    if (e.target.checked) setError("commitment", "");
  });

  form.addEventListener("submit", handleSubmit);

  $("#copy-btn").addEventListener("click", copyRegNo);
  $("#again-btn").addEventListener("click", resetForm);
}

/* --------------------------------------------------------------------------
   Init
   -------------------------------------------------------------------------- */
function init() {
  bindEventInfo();
  bindEvents();
  if (!CONFIG.API_URL) console.warn("[CONFIG] API_URL belum diisi. Form tidak dapat mengirim data.");
  checkQuota();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
