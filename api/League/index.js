const { getContainerClient } = require('../shared/blobStore');

const BLOB_NAME = 'current.json';

module.exports = async function (context, req) {
  try {
    const container = getContainerClient();
    await container.createIfNotExists();
    const blob = container.getBlockBlobClient(BLOB_NAME);

    if (req.method === 'GET') {
      const exists = await blob.exists();
      if (!exists) {
        context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: 'null' };
        return;
      }
      const downloaded = await blob.downloadToBuffer();
      context.res = {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: downloaded.toString('utf-8'),
      };
      return;
    }

    if (req.method === 'PUT') {
      const body = JSON.stringify(req.body ?? {});
      await blob.upload(body, Buffer.byteLength(body), { overwrite: true });
      context.res = {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true }),
      };
      return;
    }

    context.res = { status: 405, body: 'Method not allowed' };
  } catch (err) {
    context.log.error(err);
    context.res = { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
  }
};
