// Signed, HTTP-only cookies. No server-side session storage needed.
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { isLocal } from './http.mjs';

export const SESSION_COOKIE = 'studio_session';
export const CHALLENGE_COOKIE = 'studio_challenge';
const SESSION_TTL_SEC = 60 * 60 * 24 * 30;
const CHALLENGE_TTL_SEC = 5 * 60;

function sign(secret, payload) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function makeToken(secret, data, ttlSec) {
  const body = Buffer.from(
    JSON.stringify({ ...data, exp: Date.now() + ttlSec * 1000, n: randomBytes(6).toString('hex') }),
  ).toString('base64url');
  return `${body}.${sign(secret, body)}`;
}

export function readToken(secret, token) {
  if (!secret || !token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = sign(secret, body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

export function getCookie(req, name) {
  const header = req.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

function cookie(req, name, value, maxAge) {
  const secure = isLocal(req) ? '' : ' Secure;';
  return `${name}=${value}; HttpOnly;${secure} SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export function sessionCookie(req) {
  return cookie(req, SESSION_COOKIE, makeToken(process.env.SESSION_SECRET, { role: 'owner' }, SESSION_TTL_SEC), SESSION_TTL_SEC);
}

export function clearSessionCookie(req) {
  return cookie(req, SESSION_COOKIE, '', 0);
}

export function challengeCookie(req, challenge, kind) {
  return cookie(req, CHALLENGE_COOKIE, makeToken(process.env.SESSION_SECRET, { challenge, kind }, CHALLENGE_TTL_SEC), CHALLENGE_TTL_SEC);
}

export function readChallenge(req, kind) {
  const data = readToken(process.env.SESSION_SECRET, getCookie(req, CHALLENGE_COOKIE));
  return data && data.kind === kind ? data.challenge : null;
}

export function isAuthed(req) {
  const data = readToken(process.env.SESSION_SECRET, getCookie(req, SESSION_COOKIE));
  return !!data && data.role === 'owner';
}
