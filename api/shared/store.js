const crypto = require('crypto');
const { getContainerClient } = require('./blobStore');

// The league itself: one JSON document. Every save checks it is replacing the
// version the person last saw (the blob's ETag), so two people saving at once
// can't silently wipe each other's changes.
const DOC = 'current.json';

let readyPromise = null;
async function container() {
  const c = getContainerClient();
  if (!readyPromise) readyPromise = c.createIfNotExists();
  await readyPromise;
  return c;
}

// → { data, version } ; data is null when nothing has been saved yet
async function readDoc() {
  const c = await container();
  const blob = c.getBlockBlobClient(DOC);
  try {
    const res = await blob.download();
    const text = (await streamToBuffer(res.readableStreamBody)).toString('utf-8');
    return { data: text.trim() === '' || text.trim() === 'null' ? null : JSON.parse(text), version: res.etag };
  } catch (err) {
    if (err.statusCode === 404) return { data: null, version: null };
    throw err;
  }
}

// Saves only if the stored document is still `version` (null = must not exist yet).
// → new version, or null if someone else saved first.
async function writeDoc(data, version) {
  const c = await container();
  const blob = c.getBlockBlobClient(DOC);
  const body = JSON.stringify(data);
  const conditions = version ? { ifMatch: version } : { ifNoneMatch: '*' };
  try {
    const res = await blob.upload(body, Buffer.byteLength(body), { conditions });
    return res.etag;
  } catch (err) {
    if (err.statusCode === 412 || err.statusCode === 409) return null;
    throw err;
  }
}

// Overwrites whatever is there (used by restore).
async function forceWriteDoc(data) {
  const c = await container();
  const body = JSON.stringify(data);
  const res = await c.getBlockBlobClient(DOC).upload(body, Buffer.byteLength(body));
  return res.etag;
}

async function readText(name) {
  const c = await container();
  try {
    return (await c.getBlockBlobClient(name).downloadToBuffer()).toString('utf-8');
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

async function writeText(name, text) {
  const c = await container();
  await c.getBlockBlobClient(name).upload(text, Buffer.byteLength(text));
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

// ---- passwords: stored scrambled in secure/, which the API never hands out ----
//   secure/pw-admin.json   the admin password
//   secure/pw-team.json    the team leaders' password
// Until changed in the app, the old passwords still work: the admin one from the
// ADMIN_PASSWORD setting (or the original built-in one), the team leaders' one
// from the old copy kept in the league data (or TEAM_PASSWORD, or the original).
// The first correct sign-in stores it scrambled.

function hash(pw, salt) {
  return crypto.scryptSync(String(pw), salt, 32).toString('hex');
}

function sameText(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function setPassword(which, pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  await writeText(`secure/pw-${which}.json`, JSON.stringify({ salt, hash: hash(pw, salt) }));
}

async function checkPassword(which, pw) {
  if (typeof pw !== 'string' || !pw) return false;
  const raw = await readText(`secure/pw-${which}.json`);
  if (raw) {
    const { salt, hash: stored } = JSON.parse(raw);
    const got = Buffer.from(hash(pw, salt), 'hex');
    const want = Buffer.from(stored, 'hex');
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  }
  let starter;
  if (which === 'admin') starter = process.env.ADMIN_PASSWORD || 'fish';
  else {
    const { data } = await readDoc();
    starter = (data && data.teamPassword) || process.env.TEAM_PASSWORD || 'chips';
  }
  if (!sameText(pw, starter)) return false;
  await setPassword(which, pw);
  return true;
}

// auth = { role: 'admin' | 'team', password } → 'admin' | 'team' | null
async function verifyAuth(auth) {
  if (!auth || typeof auth !== 'object') return null;
  if (auth.role === 'admin') return (await checkPassword('admin', auth.password)) ? 'admin' : null;
  if (auth.role === 'team') return (await checkPassword('team', auth.password)) ? 'team' : null;
  return null;
}

// The old app kept the team leaders' password as plain text inside the league
// data. If it's there and hasn't been moved yet, store it scrambled before the
// data is saved without it (so the password the team leaders know keeps working).
async function moveOldTeamPassword(data) {
  if (!data || typeof data.teamPassword !== 'string' || !data.teamPassword) return;
  if (await readText('secure/pw-team.json')) return;
  await setPassword('team', data.teamPassword);
}

// Never send or keep the old plain-text team password.
function clean(data) {
  if (!data || typeof data !== 'object') return data;
  const { teamPassword, ...rest } = data;
  return rest;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { container, readDoc, writeDoc, forceWriteDoc, readText, writeText, setPassword, verifyAuth, moveOldTeamPassword, clean, wait };
