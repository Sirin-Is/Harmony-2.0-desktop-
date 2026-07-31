// Portable backups are encrypted in the renderer before they leave the app.
// The password never becomes part of the file or local database.

const FORMAT = 'harmony-backup';
const VERSION = 2;
const PBKDF2_ITERATIONS = 600000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function deriveKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export function isEncryptedBackup(value) {
  return value?.format === FORMAT && value?.version === VERSION && value?.encrypted === true;
}

export async function createEncryptedBackup(database, password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const payload = { format: FORMAT, version: 1, createdAt: new Date().toISOString(), clientCount: Array.isArray(database?.clients) ? database.clients.length : 0, database };
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(payload)));
  return {
    format: FORMAT, version: VERSION, encrypted: true,
    kdf: { algorithm: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: bytesToBase64(salt) },
    cipher: { algorithm: 'AES-GCM', iv: bytesToBase64(iv) },
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptBackup(envelope, password) {
  try {
    if (!isEncryptedBackup(envelope) || envelope.kdf?.algorithm !== 'PBKDF2' || envelope.kdf?.hash !== 'SHA-256' || envelope.cipher?.algorithm !== 'AES-GCM') throw new Error('invalid');
    const iterations = Number(envelope.kdf.iterations);
    if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000) throw new Error('invalid');
    const key = await deriveKey(password, base64ToBytes(envelope.kdf.salt), iterations);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(envelope.cipher.iv) }, key, base64ToBytes(envelope.ciphertext));
    const payload = JSON.parse(decoder.decode(plaintext));
    if (payload?.format !== FORMAT || !payload?.database || !Array.isArray(payload.database.clients)) throw new Error('invalid');
    return payload;
  } catch {
    throw new Error('Невірний пароль або пошкоджений файл резервної копії.');
  }
}
