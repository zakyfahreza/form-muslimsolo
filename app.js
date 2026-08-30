/**
 * app.js — Sistem Pendaftaran Daurah
 * Masjid Ar Rahman Surakarta · Muslim Solo
 *
 * ⚠️  PENTING: Ganti nilai APPS_SCRIPT_URL dengan URL Web App
 *    Google Apps Script Anda setelah deploy Code.gs
 */

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyiTGfDhKkjQp-TEGW-kQVjadwIyOVY3loxj6EmMBZW-Fh30shk2mwPmq0uFHcKaXk9/exec';

const WHATSAPP_GROUP_URL = 'https://chat.whatsapp.com/FPAFrWRa0APK4cH0qxcItF';
const REKENING_NUMBER = '5808919191';

/* ==========================================================
   DOM References
   ========================================================== */

const page1 = document.getElementById('page-1');
const page2 = document.getElementById('page-2');
const registrationForm = document.getElementById('registration-form');
const btnSubmit = document.getElementById('btn-submit');
const btnText = btnSubmit.querySelector('.btn-text');
const btnLoading = btnSubmit.querySelector('.btn-loading');
const regIdDisplay = document.getElementById('reg-id-display');
const alertError = document.getElementById('alert-error');
const btnCopy = document.getElementById('btn-copy');
const btnCopyText = document.getElementById('btn-copy-text');
const progressLinePage2 = document.getElementById('progress-line-p2');
const stepSelesaiPage2 = document.getElementById('step-selesai-p2');

/* ==========================================================
   Validation Rules
   ========================================================== */

/**
 * Validasi nomor WhatsApp Indonesia:
 * - Diawali 08, 628, atau +628
 * - Panjang 9–13 digit setelah prefix
 */
function isValidWhatsApp(value) {
  const cleaned = value.replace(/[\s\-().]/g, '');
  return /^(\+62|62|0)8[1-9][0-9]{7,11}$/.test(cleaned);
}

function isValidAge(value) {
  const age = parseInt(value, 10);
  return !isNaN(age) && age >= 1 && age <= 120;
}

function getCheckedGender() {
  const checked = document.querySelector('input[name="jenisKelamin"]:checked');
  return checked ? checked.value : '';
}

/* ==========================================================
   Field Validation & Error Display
   ========================================================== */

function setError(groupId, errorId, message) {
  const group = document.getElementById(groupId);
  const errorEl = document.getElementById(errorId);
  if (group) group.classList.add('has-error');
  if (errorEl) errorEl.textContent = message;
}

function clearError(groupId, errorId) {
  const group = document.getElementById(groupId);
  const errorEl = document.getElementById(errorId);
  if (group) group.classList.remove('has-error');
  if (errorEl) errorEl.textContent = '';
}

function clearAllErrors() {
  document.querySelectorAll('.form-group.has-error').forEach(g => g.classList.remove('has-error'));
  document.querySelectorAll('.error-text').forEach(e => e.textContent = '');
  hideGlobalError();
}

function showGlobalError(msg) {
  if (alertError) {
    alertError.textContent = msg;
    alertError.classList.add('visible');
    alertError.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function hideGlobalError() {
  if (alertError) {
    alertError.classList.remove('visible');
    alertError.textContent = '';
  }
}

/* ==========================================================
   Full Form Validation
   ========================================================== */

function validateForm() {
  let isValid = true;
  clearAllErrors();

  // Nama
  const nama = document.getElementById('nama').value.trim();
  if (!nama) {
    setError('group-nama', 'error-nama', 'Nama lengkap wajib diisi.');
    isValid = false;
  } else if (nama.length < 2) {
    setError('group-nama', 'error-nama', 'Nama terlalu pendek.');
    isValid = false;
  }

  // Jenis Kelamin
  const gender = getCheckedGender();
  if (!gender) {
    setError('group-gender', 'error-gender', 'Jenis kelamin wajib dipilih.');
    isValid = false;
  }

  // Usia
  const usia = document.getElementById('usia').value.trim();
  if (!usia) {
    setError('group-usia', 'error-usia', 'Usia wajib diisi.');
    isValid = false;
  } else if (!isValidAge(usia)) {
    setError('group-usia', 'error-usia', 'Masukkan usia yang valid (1–120 tahun).');
    isValid = false;
  }

  // WhatsApp
  const whatsapp = document.getElementById('whatsapp').value.trim();
  if (!whatsapp) {
    setError('group-whatsapp', 'error-whatsapp', 'Nomor WhatsApp wajib diisi.');
    isValid = false;
  } else if (!isValidWhatsApp(whatsapp)) {
    setError('group-whatsapp', 'error-whatsapp', 'Silakan masukkan nomor WhatsApp yang valid.');
    isValid = false;
  }

  // Domisili
  const domisili = document.getElementById('domisili').value.trim();
  if (!domisili) {
    setError('group-domisili', 'error-domisili', 'Domisili wajib diisi.');
    isValid = false;
  }

  // Checkbox persetujuan
  const persetujuan = document.getElementById('persetujuan').checked;
  if (!persetujuan) {
    setError('group-persetujuan', 'error-persetujuan', 'Silakan menyetujui penerimaan informasi melalui WhatsApp.');
    isValid = false;
  }

  // Scroll to first error
  if (!isValid) {
    const firstError = document.querySelector('.form-group.has-error');
    if (firstError) {
      firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  return isValid;
}

/* ==========================================================
   Loading State
   ========================================================== */

function setLoading(loading) {
  btnSubmit.disabled = loading;
  if (loading) {
    btnText.classList.add('hidden');
    btnLoading.classList.remove('hidden');
  } else {
    btnText.classList.remove('hidden');
    btnLoading.classList.add('hidden');
  }
}

/* ==========================================================
   Step Transition: Page 1 → Page 2
   ========================================================== */

function showPage2(registrationId) {
  // Update registration ID
  if (regIdDisplay) regIdDisplay.textContent = registrationId;

  // Update progress indicator on page 2
  if (progressLinePage2) progressLinePage2.classList.add('done');
  if (stepSelesaiPage2) {
    stepSelesaiPage2.classList.add('done');
    stepSelesaiPage2.classList.remove('active');
  }

  // Hide page 1, show page 2
  page1.classList.add('hidden');
  page2.classList.remove('hidden');
  page2.classList.add('slide-in');

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Remove animation class after it's done
  page2.addEventListener('animationend', () => {
    page2.classList.remove('slide-in');
  }, { once: true });
}

/* ==========================================================
   Submit Handler
   ========================================================== */

registrationForm.addEventListener('submit', async function (e) {
  e.preventDefault();

  if (!validateForm()) return;

  const payload = {
    nama: document.getElementById('nama').value.trim(),
    jenisKelamin: getCheckedGender(),
    usia: parseInt(document.getElementById('usia').value.trim(), 10),
    whatsapp: document.getElementById('whatsapp').value.trim().replace(/[\s\-().]/g, ''),
    domisili: document.getElementById('domisili').value.trim(),
    persetujuanWA: document.getElementById('persetujuan').checked,
  };

  setLoading(true);
  hideGlobalError();

  // Demo / development mode: jika URL belum diset, simulasikan response sukses
  if (APPS_SCRIPT_URL === 'GANTI_DENGAN_URL_APPS_SCRIPT_ANDA') {
    await simulateDelay(1800);
    const demoId = 'DRS-' + String(Math.floor(Math.random() * 9000) + 1000);
    setLoading(false);
    showPage2(demoId);
    return;
  }

  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const result = await response.json();

    if (result.success) {
      setLoading(false);
      showPage2(result.registrationId);
    } else {
      throw new Error(result.message || 'Terjadi kendala saat menyimpan data.');
    }

  } catch (err) {
    console.error('Submit error:', err);
    setLoading(false);
    showGlobalError(
      'Maaf, terjadi kendala saat menyimpan pendaftaran. Silakan coba kembali beberapa saat lagi.'
    );
  }
});

/* ==========================================================
   Real-time field validation (on blur)
   ========================================================== */

document.getElementById('nama').addEventListener('blur', function () {
  const v = this.value.trim();
  if (!v) {
    setError('group-nama', 'error-nama', 'Nama lengkap wajib diisi.');
  } else {
    clearError('group-nama', 'error-nama');
  }
});

document.getElementById('usia').addEventListener('blur', function () {
  const v = this.value.trim();
  if (!v) {
    setError('group-usia', 'error-usia', 'Usia wajib diisi.');
  } else if (!isValidAge(v)) {
    setError('group-usia', 'error-usia', 'Masukkan usia yang valid (1–120 tahun).');
  } else {
    clearError('group-usia', 'error-usia');
  }
});

document.getElementById('whatsapp').addEventListener('blur', function () {
  const v = this.value.trim();
  if (!v) {
    setError('group-whatsapp', 'error-whatsapp', 'Nomor WhatsApp wajib diisi.');
  } else if (!isValidWhatsApp(v)) {
    setError('group-whatsapp', 'error-whatsapp', 'Silakan masukkan nomor WhatsApp yang valid.');
  } else {
    clearError('group-whatsapp', 'error-whatsapp');
  }
});

document.getElementById('domisili').addEventListener('blur', function () {
  const v = this.value.trim();
  if (!v) {
    setError('group-domisili', 'error-domisili', 'Domisili wajib diisi.');
  } else {
    clearError('group-domisili', 'error-domisili');
  }
});

/* Clear error on focus */
['nama', 'usia', 'whatsapp', 'domisili'].forEach(id => {
  document.getElementById(id).addEventListener('focus', function () {
    const groupId = 'group-' + (id === 'whatsapp' ? 'whatsapp' : id);
    const errorId = 'error-' + (id === 'whatsapp' ? 'whatsapp' : id);
    clearError(groupId, errorId);
  });
});

/* Radio change */
document.querySelectorAll('input[name="jenisKelamin"]').forEach(radio => {
  radio.addEventListener('change', () => clearError('group-gender', 'error-gender'));
});

/* Checkbox change */
document.getElementById('persetujuan').addEventListener('change', function () {
  if (this.checked) clearError('group-persetujuan', 'error-persetujuan');
});

/* ==========================================================
   Copy Rekening
   ========================================================== */

btnCopy.addEventListener('click', async function () {
  try {
    await navigator.clipboard.writeText(REKENING_NUMBER);
    btnCopyText.textContent = '✓ Nomor rekening berhasil disalin';
    btnCopy.classList.add('copied');
    setTimeout(() => {
      btnCopyText.textContent = '📋 Salin Nomor Rekening';
      btnCopy.classList.remove('copied');
    }, 2500);
  } catch {
    // Fallback untuk browser yang tidak mendukung clipboard API
    const el = document.createElement('textarea');
    el.value = REKENING_NUMBER;
    el.setAttribute('readonly', '');
    el.style.position = 'absolute';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    btnCopyText.textContent = '✓ Nomor rekening berhasil disalin';
    btnCopy.classList.add('copied');
    setTimeout(() => {
      btnCopyText.textContent = '📋 Salin Nomor Rekening';
      btnCopy.classList.remove('copied');
    }, 2500);
  }
});

/* ==========================================================
   Utilities
   ========================================================== */

function simulateDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
