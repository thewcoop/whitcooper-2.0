// Passkey (Face ID / Touch ID) sign-in for the Studio.
// Routes: /api/auth/{status,register-options,register-verify,login-options,login-verify,logout}
import { timingSafeEqual } from 'node:crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { json, readJson } from '../lib/http.mjs';
import { store } from '../lib/store.mjs';
import {
  isAuthed, sessionCookie, clearSessionCookie, challengeCookie, readChallenge,
} from '../lib/session.mjs';

export const config = { path: '/api/auth/*' };

const RP_NAME = 'Whit Cooper Studio';
const USER_ID = new TextEncoder().encode('whit-studio-owner');
const MAX_SETUP_FAILS_PER_HOUR = 5;

const b64 = (bytes) => Buffer.from(bytes).toString('base64url');
const unb64 = (str) => new Uint8Array(Buffer.from(str, 'base64url'));

function missingConfig() {
  return ['SESSION_SECRET', 'SETUP_CODE', 'GITHUB_TOKEN'].filter((k) => !process.env[k]);
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

async function loadCreds(db, rpID) {
  return (await db.get(`creds:${rpID}`)) || [];
}

// The setup code is the recovery path, so it is rate limited.
async function checkSetupCode(db, code) {
  const bucket = `fails:${Math.floor(Date.now() / 3_600_000)}`;
  const fails = (await db.get(bucket)) || 0;
  if (fails >= MAX_SETUP_FAILS_PER_HOUR) return 'locked';
  if (code && safeEqual(code, process.env.SETUP_CODE)) return 'ok';
  await db.set(bucket, fails + 1);
  return 'bad';
}

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/auth\//, '').replace(/\/$/, '');
  const rpID = url.hostname;
  const origin = url.origin;

  if (route === 'logout' && req.method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(req) });
  }

  const missing = missingConfig();
  if (route === 'status') {
    if (missing.length) return json({ authed: false, missing });
    const creds = await loadCreds(store(), rpID);
    return json({ authed: isAuthed(req), hasPasskeys: creds.length > 0, missing: [] });
  }
  if (missing.length) return json({ error: 'Studio is not configured yet.', missing }, 503);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const db = store();
  const body = (await readJson(req)) || {};

  try {
    if (route === 'register-options') {
      if (!isAuthed(req)) {
        const gate = await checkSetupCode(db, body.setupCode);
        if (gate === 'locked') return json({ error: 'Too many wrong codes. Try again in an hour.' }, 429);
        if (gate !== 'ok') return json({ error: 'That setup code is not right.' }, 403);
      }
      const creds = await loadCreds(db, rpID);
      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID,
        userName: 'whit',
        userDisplayName: 'Whit',
        userID: USER_ID,
        attestationType: 'none',
        excludeCredentials: creds.map((c) => ({ id: c.id, transports: c.transports })),
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      });
      return json(options, 200, { 'Set-Cookie': challengeCookie(req, options.challenge, 'register') });
    }

    if (route === 'register-verify') {
      const expectedChallenge = readChallenge(req, 'register');
      if (!expectedChallenge) return json({ error: 'That attempt expired. Try again.' }, 400);
      // Registering requires the same gate again, so the challenge cookie alone is not enough.
      if (!isAuthed(req)) {
        const gate = await checkSetupCode(db, body.setupCode);
        if (gate !== 'ok') return json({ error: 'That setup code is not right.' }, 403);
      }
      const result = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
      if (!result.verified) return json({ error: 'Could not verify that passkey.' }, 400);
      const { credential } = result.registrationInfo;
      const creds = await loadCreds(db, rpID);
      creds.push({
        id: credential.id,
        publicKey: b64(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports || [],
        name: String(body.name || 'My device').slice(0, 40),
        createdAt: new Date().toISOString(),
      });
      await db.set(`creds:${rpID}`, creds);
      return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(req) });
    }

    if (route === 'login-options') {
      const creds = await loadCreds(db, rpID);
      if (!creds.length) return json({ error: 'No passkeys yet.', needsSetup: true }, 404);
      const options = await generateAuthenticationOptions({
        rpID,
        userVerification: 'required',
        allowCredentials: creds.map((c) => ({ id: c.id, transports: c.transports })),
      });
      return json(options, 200, { 'Set-Cookie': challengeCookie(req, options.challenge, 'login') });
    }

    if (route === 'login-verify') {
      const expectedChallenge = readChallenge(req, 'login');
      if (!expectedChallenge) return json({ error: 'That attempt expired. Try again.' }, 400);
      const creds = await loadCreds(db, rpID);
      const cred = creds.find((c) => c.id === body.response?.id);
      if (!cred) return json({ error: 'That passkey is not registered here.' }, 403);
      const result = await verifyAuthenticationResponse({
        response: body.response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: cred.id,
          publicKey: unb64(cred.publicKey),
          counter: cred.counter,
          transports: cred.transports,
        },
      });
      if (!result.verified) return json({ error: 'Could not verify that passkey.' }, 403);
      cred.counter = result.authenticationInfo.newCounter;
      await db.set(`creds:${rpID}`, creds);
      return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(req) });
    }
  } catch (err) {
    console.error('[auth]', route, err.message);
    return json({ error: 'Sign-in failed. Try again.' }, 400);
  }

  return json({ error: 'Not found' }, 404);
};
