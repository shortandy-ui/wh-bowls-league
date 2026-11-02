const { readDoc, writeDoc, verifyAuth, moveOldTeamPassword, clean, wait } = require('../shared/store');

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const SCORE_FIELDS = ['date', 'h1', 'a1', 'h2', 'a2'];

// Did any score or date change?
function resultsChanged(before, after) {
  const map = new Map();
  for (const d of before?.divisions || []) for (const f of d.fixtures || []) map.set(`${d.id}:${f.id}`, f);
  for (const d of after?.divisions || []) {
    for (const f of d.fixtures || []) {
      const old = map.get(`${d.id}:${f.id}`);
      if (!old || SCORE_FIELDS.some((k) => String(old[k] ?? '') !== String(f[k] ?? ''))) return true;
    }
  }
  return false;
}

// Team leaders may only change scores and dates: everything else must be exactly as it was.
function onlyResultsChanged(before, after) {
  const strip = (doc) => ({
    ...doc,
    divisions: (doc?.divisions || []).map((d) => ({
      ...d,
      fixtures: (d.fixtures || []).map((f) => {
        const rest = { ...f };
        SCORE_FIELDS.forEach((k) => delete rest[k]);
        return rest;
      }),
    })),
  });
  return same(strip(before), strip(after));
}

module.exports = async function (context, req) {
  try {
    if (req.method === 'GET') {
      const { data, version } = await readDoc();
      await moveOldTeamPassword(data);
      return (context.res = json(200, { data: clean(data), version }));
    }

    // PUT { data, baseVersion, auth }
    const { data, baseVersion, auth } = req.body || {};
    if (!data || typeof data !== 'object' || !Array.isArray(data.divisions)) return (context.res = json(400, { error: 'bad data' }));
    const role = await verifyAuth(auth);
    if (!role) {
      await wait(500);
      return (context.res = json(401, { error: 'Please sign in again.' }));
    }

    const current = await readDoc();
    await moveOldTeamPassword(current.data);
    if ((current.version || null) !== (baseVersion || null)) {
      return (context.res = json(409, { error: 'changed', data: clean(current.data), version: current.version }));
    }
    const before = clean(current.data) || {};
    const next = clean(data);

    if (role === 'team' && !onlyResultsChanged(before, next)) {
      return (context.res = json(403, { error: 'Team leaders can only enter scores and dates.' }));
    }
    // The lock applies to everyone: the admin unlocks first, then changes results.
    if (before.resultsLocked && next.resultsLocked && resultsChanged(before, next)) {
      return (context.res = json(423, { error: 'Results are locked.' }));
    }

    const version = await writeDoc(next, current.version);
    if (!version) {
      const fresh = await readDoc();
      return (context.res = json(409, { error: 'changed', data: clean(fresh.data), version: fresh.version }));
    }
    context.res = json(200, { ok: true, version });
  } catch (err) {
    context.log.error(err);
    context.res = json(500, { error: 'server error' });
  }
};
