import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export function encryptCredential(value, key, owner) {
  const raw = Buffer.from(key, 'base64'); if (raw.length !== 32) throw new Error('Calendar encryption key is not configured.');
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm',raw,iv); cipher.setAAD(Buffer.from(owner));
  const data = Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return { iv:iv.toString('base64'), tag:cipher.getAuthTag().toString('base64'), data:data.toString('base64') };
}
export function decryptCredential(value,key,owner) {
  const decipher = createDecipheriv('aes-256-gcm',Buffer.from(key,'base64'),Buffer.from(value.iv,'base64'));
  decipher.setAAD(Buffer.from(owner)); decipher.setAuthTag(Buffer.from(value.tag,'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data,'base64')),decipher.final()]).toString('utf8'));
}
