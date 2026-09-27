// Encrypts user-supplied API keys at rest (AES-256-GCM). The key comes from API_KEY_SECRET,
// which lives only in the server's .env; without it, saving keys is disabled.
const crypto = require('crypto');

const secretKey = () => (process.env.API_KEY_SECRET ? crypto.createHash('sha256').update(process.env.API_KEY_SECRET).digest() : null);
const canStoreKeys = () => !!secretKey();

function encrypt(text) {
  const key = secretKey();
  if (!key) throw new Error('API_KEY_SECRET not set');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

function decrypt(blob) {
  const key = secretKey();
  if (!key) throw new Error('API_KEY_SECRET not set');
  const buf = Buffer.from(blob, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt, canStoreKeys };
