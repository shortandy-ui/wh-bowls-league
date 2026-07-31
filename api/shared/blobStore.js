const { BlobServiceClient } = require('@azure/storage-blob');

const CONTAINER_NAME = 'league-data';

function getContainerClient() {
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING application setting is not configured');
  }
  const service = BlobServiceClient.fromConnectionString(connStr);
  return service.getContainerClient(CONTAINER_NAME);
}

module.exports = { getContainerClient, CONTAINER_NAME };
