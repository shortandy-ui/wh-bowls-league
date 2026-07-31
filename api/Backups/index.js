const { getContainerClient } = require('../shared/blobStore');

module.exports = async function (context, req) {
  try {
    const container = getContainerClient();
    await container.createIfNotExists();
    const results = [];
    for await (const item of container.listBlobsFlat({ prefix: 'backups/' })) {
      results.push({ name: item.name, lastModified: item.properties.lastModified });
    }
    results.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(results),
    };
  } catch (err) {
    context.log.error(err);
    context.res = { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
  }
};
