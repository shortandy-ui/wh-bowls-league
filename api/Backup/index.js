const { getContainerClient } = require('../shared/blobStore');

module.exports = async function (context, req) {
  try {
    const container = getContainerClient();
    await container.createIfNotExists();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const blob = container.getBlockBlobClient(`backups/backup-${stamp}.json`);
    const body = JSON.stringify(req.body ?? {});
    await blob.upload(body, Buffer.byteLength(body), { overwrite: true });
    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, timestamp: stamp }),
    };
  } catch (err) {
    context.log.error(err);
    context.res = { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
  }
};
