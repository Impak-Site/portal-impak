'use strict';
// Implementação própria de TOTP (RFC 6238) e HOTP (RFC 4226) usando apenas
// o módulo `crypto` nativo do Node — sem depender do pacote `otplib`.
//
// Motivo: `otplib` (e suas dependências transitivas @otplib/plugin-crypto-noble
// e @otplib/plugin-base32-scure, que puxam @noble/hashes e @scure/base) tiveram
// lançamentos recentes que se tornaram ESM-only, quebrando `require()` no
// Node 18 (runtime do Railway) com ERR_REQUIRE_ESM. Isso já causou dois
// incidentes de indisponibilidade em produção. Esta implementação evita por
// completo o problema: zero dependências externas, então não há superfície
// para landmines de ESM/CJS em atualizações futuras de pacotes de terceiros.

const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/=+$/, '').replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateSecret(length = 20) {
  return base32Encode(crypto.randomBytes(length));
}

function hotp(secretBase32, counter, digits = 6, algorithm = 'sha1') {
  const key = base32Decode(secretBase32);
  const counterBuf = Buffer.alloc(8);
  // Escreve o contador como big-endian de 64 bits.
  let c = BigInt(counter);
  for (let i = 7; i >= 0; i--) {
    counterBuf[i] = Number(c & 0xffn);
    c >>= 8n;
  }
  const hmac = crypto.createHmac(algorithm, key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = (binCode % Math.pow(10, digits)).toString().padStart(digits, '0');
  return otp;
}

function currentCounter(period = 30, epoch = Date.now()) {
  return Math.floor(epoch / 1000 / period);
}

function generate({ secret, digits = 6, period = 30, algorithm = 'sha1', epoch = Date.now() } = {}) {
  return hotp(secret, currentCounter(period, epoch), digits, algorithm);
}

// Compara token com tolerância de +-1 janela de tempo (padrão comum de
// clientes de 2FA, absorve pequena diferença de relógio entre dispositivos).
function verify({ secret, token, digits = 6, period = 30, algorithm = 'sha1', epoch = Date.now(), window = 1 } = {}) {
  const t = String(token || '').trim();
  if (!/^\d+$/.test(t)) return { valid: false };
  const counter = currentCounter(period, epoch);
  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    const candidate = hotp(secret, counter + errorWindow, digits, algorithm);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(t.padStart(digits, '0')))) {
      return { valid: true, delta: errorWindow };
    }
  }
  return { valid: false };
}

function generateURI({ secret, label, issuer, algorithm = 'SHA1', digits = 6, period = 30 } = {}) {
  const encLabel = encodeURIComponent(label || '');
  const encIssuer = encodeURIComponent(issuer || '');
  const params = new URLSearchParams({
    secret,
    issuer: issuer || '',
    algorithm,
    digits: String(digits),
    period: String(period),
  });
  return `otpauth://totp/${encIssuer}:${encLabel}?${params.toString()}`;
}

module.exports = { generateSecret, generate, verify, generateURI, base32Encode, base32Decode, hotp };
