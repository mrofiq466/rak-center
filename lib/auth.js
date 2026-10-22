'use strict';
/**
 * lib/auth.js — autentikasi untuk server Rak.
 *
 * Model: satu password (dari env atau dibuat acak saat pertama jalan).
 * Disimpan sebagai hash scrypt, TIDAK pernah plaintext.
 * Sesi memakai cookie bertanda tangan HMAC, httpOnly + SameSite=Strict.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 hari
const SCRYPT_KEYLEN = 64;

/* ------------------------------------------------------------ password */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const parts = String(stored).split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expected] = parts;
  let actual;
  try {
    actual = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
  } catch {
    return false;
  }
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function generatePassword() {
  // 20 karakter, tanpa karakter yang mudah tertukar (0/O, 1/l/I)
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(20);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

/* -------------------------------------------------------------- session */

function signSession(secret, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySession(secret, token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

/* -------------------------------------------------------------- storage */

/**
 * Muat atau buat berkas auth di folder data.
 * @param {string} dataDir
 * @param {string|undefined} password  password dari env; jika undefined dibuat acak
 *
 * Catatan: password dari env selalu menang — kalau RAK_PASSWORD diubah,
 * hash yang tersimpan ikut diperbarui. Tanpa itu, user akan
 * "passwordnya tidak berlaku" padahal hanya lupa bahwa hash lama masih dipakai.
 */
function loadAuth(dataDir, password) {
  const file = path.join(dataDir, 'auth.json');
  let stored = null;
  try {
    stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { /* belum ada -> dibuat baru */ }

  const isFirstRun = !stored || !stored.passwordHash;
  const plain = password || (isFirstRun ? generatePassword() : null);
  const passwordHash = password
    ? hashPassword(password)                       // env selalu menang
    : (stored?.passwordHash || hashPassword(plain));

  const record = {
    passwordHash,
    secret: stored?.secret || crypto.randomBytes(32).toString('hex'),
    createdAt: stored?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  return { record, plain, isFirstRun: isFirstRun && !password };
}

module.exports = {
  hashPassword,
  verifyPassword,
  generatePassword,
  signSession,
  verifySession,
  parseCookies,
  loadAuth,
  SESSION_TTL_MS
};
