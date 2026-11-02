const crypto = require('crypto');
const { container, readDoc, forceWriteDoc, verifyAuth, moveOldTeamPassword, clean, wait } = require('../shared/store');

// Backups are copies of the league kept in backups/ (only the newest KEEP are kept).
// POST /api/backup
//   { action: 'run', auth }                      admin — or the weekly job, with the x-backup-key header
//   { action: 'list', auth }                     admin
//   { action: 'restore', auth, name, confirm }   admin; confirm must be "RESTORE"
const KEEP = 5;

const json = (status, body) => ({ status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

function keyOk(req) {
  const want = process.env.BACKUP_KEY || '';
  const got = String(req.headers['x-backup-key'] || '');
  if (want.length < 16 || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

async function listBackups(c) {
  const out = [];
  for await (const item of c.listBlobsFlat({ prefix: 'backups/' })) {
    out.push({ name: item.name, lastModified: item.properties.lastModified });
  }
  return out.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
}

module.exports = async function (context, req) {
  try {
    const { action, auth, name, confirm, reason } = req.body || {};
    const isAdmin = (await verifyAuth(auth)) === 'admin';
    const c = await container();

    if (action === 'run') {
      if (!isAdmin && !keyOk(req)) {
        await wait(600);
        return (context.res = json(401, { error: 'not allowed' }));
      }
      const { data } = await readDoc();
      if (!data) return (context.res = json(200, { ok: true, skipped: 'nothing to back up yet' }));
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const kind = isAdmin ? 'manual' : 'weekly';
      const body = JSON.stringify(clean(data));
      await c.getBlockBlobClient(`backups/backup-${stamp}-${kind}.json`).upload(body, Buffer.byteLength(body));
      const all = await listBackups(c);
      for (const old of all.slice(KEEP)) await c.getBlockBlobClient(old.name).deleteIfExists();
      return (context.res = json(200, { ok: true, name: `backups/backup-${stamp}-${kind}.json`, reason: reason || null }));
    }

    if (!isAdmin) {
      await wait(600);
      return (context.res = json(401, { error: 'admin only' }));
    }

    if (action === 'list') return (context.res = json(200, { ok: true, backups: await listBackups(c) }));

    if (action === 'restore') {
      if (confirm !== 'RESTORE') return (context.res = json(400, { error: 'Type RESTORE to confirm.' }));
      if (typeof name !== 'string' || !/^backups\/backup-[0-9TZ-]+(-manual|-weekly)?\.json$/.test(name)) {
        return (context.res = json(400, { error: 'bad backup name' }));
      }
      let text;
      try {
        text = (await c.getBlockBlobClient(name).downloadToBuffer()).toString('utf-8');
      } catch (err) {
        if (err.statusCode === 404) return (context.res = json(404, { error: 'That backup no longer exists.' }));
        throw err;
      }
      const data = JSON.parse(text);
      await moveOldTeamPassword(data);
      const version = await forceWriteDoc(clean(data));
      return (context.res = json(200, { ok: true, data: clean(data), version }));
    }

    context.res = json(400, { error: 'unknown action' });
  } catch (err) {
    context.log.error(err);
    context.res = json(500, { error: 'server error' });
  }
};
