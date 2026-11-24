'use strict';

/**
 * Session helpers. Sessions live in SQLite and the browser only holds an
 * httpOnly cookie token, so authentication is enforced by the server on every
 * admin API call.
 */
const crypto = require('node:crypto');
const { db, nowIso } = require('./db');

const COOKIE = 'pz_session';
const SESSION_HOURS = 8;

function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function createSession(adminId, userAgent = '') {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_HOURS * 3600000).toISOString();
  db.prepare('INSERT INTO sessions (token, admin_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)')
    .run(token, adminId, nowIso(), expires, String(userAgent).slice(0, 250));
  return { token, expires };
}

function getSession(req) {
  const token = parseCookies(req.headers.cookie || '')[COOKIE];
  if (!token) return null;
  const row = db.prepare(`SELECT s.token, s.expires_at, a.id AS admin_id, a.username
    FROM sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token = ?`).get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return row;
}

function destroySession(req) {
  const token = parseCookies(req.headers.cookie || '')[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  return token;
}

function cookieHeader(token, maxAgeSeconds) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}` +
    (process.env.NODE_ENV === 'production' ? '; Secure' : '');
}

function requireAdmin(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Sesi berakhir. Silakan login kembali.' });
  req.admin = session;
  next();
}

module.exports = {
  parseCookies,
  createSession,
  getSession,
  destroySession,
  cookieHeader,
  requireAdmin,
  COOKIE,
  SESSION_HOURS,
};
