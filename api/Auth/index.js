const { verifyAuth, setPassword, wait } = require('../shared/store');

const json = (status, body) => ({ status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

// POST /api/auth
//   { action: 'login', auth }                                 → { ok, role }
//   { action: 'setPassword', auth, target, newPassword }      admin only; target 'admin' | 'team'
module.exports = async function (context, req) {
  try {
    const { action, auth, target, newPassword } = req.body || {};
    const role = await verifyAuth(auth);

    if (action === 'login') {
      if (!role) {
        await wait(600); // slows down guessing
        return (context.res = json(401, { ok: false }));
      }
      return (context.res = json(200, { ok: true, role }));
    }

    if (action === 'setPassword') {
      if (role !== 'admin') {
        await wait(600);
        return (context.res = json(401, { error: 'admin only' }));
      }
      if (target !== 'admin' && target !== 'team') return (context.res = json(400, { error: 'bad target' }));
      if (typeof newPassword !== 'string' || newPassword.trim().length < 4) {
        return (context.res = json(400, { error: 'The password must be at least 4 characters.' }));
      }
      await setPassword(target, newPassword.trim());
      return (context.res = json(200, { ok: true }));
    }

    context.res = json(400, { error: 'unknown action' });
  } catch (err) {
    context.log.error(err);
    context.res = json(500, { error: 'server error' });
  }
};
