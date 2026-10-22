'use strict';
/**
 * lib/guard.js — lapis keamanan untuk server lokal Rak.
 *
 * App ini berjalan di localhost milik pengguna, tapi tetap mengambil URL dari
 * input pengguna (proxy gambar, scrape komik). Tanpa guard, input itu bisa
 * dipakai sebagai "jembatan" (SSRF) untuk menjangkau jaringan privat Trilogy
 * komputer pengguna. Modul ini menutup celah itu.
 */

const dns = require('dns').promises;
const net = require('net');

/* ------------------------------------------------------------------ URL */

/** Hanya izinkan http/https. Tolak file:, gopher:, data:, dll. */
function isAllowedProtocol(url) {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

/** Rentang IPv4 yang tidak boleh dijangkau (loopback, private, link-local, CGNAT, multicast). */
const PRIVATE_V4 = [
  ['0.0.0.0', 8],        // "this" network
  ['10.0.0.0', 8],       // RFC1918
  ['100.64.0.0', 10],    // CGNAT
  ['127.0.0.0', 8],      // loopback
  ['169.254.0.0', 16],   // link-local / cloud metadata (169.254.169.254)
  ['172.16.0.0', 12],    // RFC1918
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.0.2.0', 24],     // TEST-NET-1
  ['192.168.0.0', 16],   // RFC1918
  ['198.18.0.0', 15],    // benchmarking
  ['198.51.100.0', 24],  // TEST-NET-2
  ['203.0.113.0', 24],   // TEST-NET-3
  ['224.0.0.0', 4],      // multicast
  ['240.0.0.0', 4]       // reserved
];

function v4ToInt(ip) {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isPrivateV4(ip) {
  const addr = v4ToInt(ip);
  return PRIVATE_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (addr & mask) === (v4ToInt(base) & mask);
  });
}

function isPrivateV6(ip) {
  const addr = ip.toLowerCase().split('%')[0];
  if (addr === '::1' || addr === '::') return true;
  // IPv4-mapped (::ffff:127.0.0.1)
  const mapped = addr.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/);
  if (mapped) return isPrivateV4(mapped[1]);
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true;   // unique local
  if (addr.startsWith('fe8') || addr.startsWith('fe9') || addr.startsWith('fea') || addr.startsWith('feb')) return true; // link-local
  return false;
}

function isPrivateIp(ip) {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateV4(ip);
  if (version === 6) return isPrivateV6(ip);
  return true; // bukan IP -> anggap tidak aman, biarkan caller yang putuskan
}

/** Hostname yang jelas-jelas internal. */
function isInternalHostname(hostname) {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.home.arpa')) return true;
  if (h === 'metadata.google.internal' || h.endsWith('.metadata.google.internal')) return true;
  if (!h.includes('.')) return true;  // nama host tunggal (LAN)
  return false;
}

/**
 * Validasi URL tujuan fetch server.
 * @returns {Promise<{ok: true, url: URL} | {ok: false, reason: string}>}
 */
async function validateRemoteUrl(rawUrl, { allowPrivate = false } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'URL tidak valid' };
  }
  if (!isAllowedProtocol(url)) {
    return { ok: false, reason: `Protokol ${url.protocol} tidak diizinkan (hanya http/https)` };
  }
  if (allowPrivate) return { ok: true, url };

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) return { ok: false, reason: 'Alamat jaringan internal/private tidak diizinkan' };
    return { ok: true, url };
  }
  if (isInternalHostname(host)) {
    return { ok: false, reason: 'Host internal tidak diizinkan' };
  }
  // Resolve DNS untuk menutupi DNS rebinding & host yang menunjuk IP privat
  let records;
  try {
    records = await dns.lookup(host, { all: true });
  } catch {
    return { ok: false, reason: 'Hostname tidak bisa diresolusi' };
  }
  for (const record of records) {
    if (isPrivateIp(record.address)) {
      return { ok: false, reason: 'Host mengarah ke alamat jaringan internal/private' };
    }
  }
  return { ok: true, url };
}

/* -------------------------------------------------------------- BODY */

/** Kunci berbahaya untuk prototype pollution. */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Buang kunci berbahaya dari body (anti prototype pollution).
 * Object.assign() memakai setter __proto__, jadi body mentah BERBAHAYA.
 * Nilai objek/array tetap diteruskan (dipakai untuk latestChapter & friends),
 * hanya dibersihkan secara rekursif.
 */
function sanitizeValue(value, depth = 0) {
  if (depth > 6) return undefined;
  if (value === null) return null;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return value;
  if (type !== 'object') return undefined; // function/symbol/undefined dibuang
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, depth + 1)).filter((entry) => entry !== undefined);
  }
  const clean = {};
  for (const [key, entry] of Object.entries(value)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    const safe = sanitizeValue(entry, depth + 1);
    if (safe !== undefined) clean[key] = safe;
  }
  return clean;
}

function sanitizeBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  return sanitizeValue(body) || {};
}

/* ------------------------------------------------------- RATE LIMITER */

/**
 * Pembatas laju sederhana in-memory (per IP).
 * Cukup untuk mencegah penyalahgunaan proxy di mesin lokal.
 */
function createRateLimiter({ windowMs = 60_000, max = 30 } = {}) {
  const hits = new Map();
  return function check(key = 'global') {
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) return false;
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) hits.clear(); // bebaskan memori
    return true;
  };
}

module.exports = {
  validateRemoteUrl,
  isAllowedProtocol,
  isPrivateIp,
  isInternalHostname,
  sanitizeBody,
  createRateLimiter
};
