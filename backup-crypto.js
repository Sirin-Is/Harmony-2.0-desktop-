// Portable backups are encrypted in the renderer before they leave the app.
// The password never becomes part of the file or local database.

import { collectDatabaseRelationshipIssues } from './data/database-validation.js';
import { validateDatabaseIdentifiers } from './data/identifier-validation.js';
import { passwordPolicyError } from './password-policy.js';

const FORMAT = 'harmony-backup';
const VERSION = 2;
const PBKDF2_ITERATIONS = 600000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ARRAY_COLLECTIONS = ['clients', 'customColumns', 'calendarEvents', 'hrOrders', 'hrMonthlyDocuments', 'payrollRecords', 'auditOperations', 'auditEvents'];
const OBJECT_COLLECTIONS = ['monthlyPayments', 'taxRecords', 'incomeRecords', 'reportRecords', 'settings'];
export const MAX_BACKUP_FILE_BYTES = 25 * 1024 * 1024;
const MAX_COLLECTION_RECORDS = 50000;
const MAX_TOTAL_RECORDS = 100000;
const MAX_STRUCTURE_NODES = 500000;
const MAX_STRUCTURE_DEPTH = 20;
const MAX_STRING_CHARS = 250000;
const MAX_TOTAL_STRING_CHARS = 20 * 1024 * 1024;
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function assertBackupFileSize(file) {
  const size = Number(file?.size);
  if (!Number.isFinite(size) || size <= 0) throw new Error('Файл резервної копії порожній або недоступний.');
  if (size > MAX_BACKUP_FILE_BYTES) throw new Error('Файл резервної копії завеликий. Максимальний розмір — 25 МБ.');
}

function validateStructureLimits(root) {
  const stack = [{ value: root, depth: 0 }];
  const visited = new WeakSet();
  let nodes = 0;
  let totalStringChars = 0;
  while (stack.length) {
    const { value, depth } = stack.pop();
    nodes += 1;
    if (nodes > MAX_STRUCTURE_NODES) throw new Error('Резервна копія містить забагато елементів.');
    if (typeof value === 'string') {
      if (value.length > MAX_STRING_CHARS) throw new Error('Резервна копія містить надто довге текстове поле.');
      totalStringChars += value.length;
      if (totalStringChars > MAX_TOTAL_STRING_CHARS) throw new Error('Резервна копія містить забагато текстових даних.');
      continue;
    }
    if (value === null || typeof value !== 'object') continue;
    if (depth >= MAX_STRUCTURE_DEPTH) throw new Error('Резервна копія має надто глибоку структуру.');
    if (visited.has(value)) throw new Error('Резервна копія містить циклічну структуру.');
    visited.add(value);
    const entries = Array.isArray(value) ? value.entries() : Object.entries(value);
    for (const [key, child] of entries) {
      if (!Array.isArray(value)) {
        if (UNSAFE_KEYS.has(key)) throw new Error('Резервна копія містить небезпечне ім’я поля.');
        totalStringChars += key.length;
        if (totalStringChars > MAX_TOTAL_STRING_CHARS) throw new Error('Резервна копія містить забагато текстових даних.');
      }
      stack.push({ value: child, depth: depth + 1 });
    }
  }
}

/** Reject malformed restore inputs before they can replace local data.
 * Optional collections remain optional for compatibility with older copies. */
export function validateBackupDatabase(database) {
  if (!isPlainObject(database) || !Array.isArray(database.clients)) throw new Error('Файл не схожий на повну резервну копію Harmony.');
  validateStructureLimits(database);
  let totalRecords = 0;
  for (const collection of ARRAY_COLLECTIONS) {
    if (database[collection] === undefined) continue;
    if (!Array.isArray(database[collection])) throw new Error(`Некоректний розділ резервної копії: ${collection}.`);
    if (database[collection].length > MAX_COLLECTION_RECORDS) throw new Error(`Забагато записів у розділі: ${collection}.`);
    totalRecords += database[collection].length;
    const ids = new Set();
    for (const record of database[collection]) {
      if (!isPlainObject(record) || typeof record.id !== 'string' || !record.id.trim()) throw new Error(`Некоректний запис у розділі: ${collection}.`);
      if (ids.has(record.id)) throw new Error(`Повторюваний ідентифікатор у розділі: ${collection}.`);
      ids.add(record.id);
    }
  }
  for (const collection of OBJECT_COLLECTIONS) {
    if (database[collection] !== undefined && !isPlainObject(database[collection])) throw new Error(`Некоректний розділ резервної копії: ${collection}.`);
    const count = database[collection] === undefined ? 0 : Object.keys(database[collection]).length;
    if (count > MAX_COLLECTION_RECORDS) throw new Error(`Забагато записів у розділі: ${collection}.`);
    totalRecords += count;
  }
  if (totalRecords > MAX_TOTAL_RECORDS) throw new Error('Резервна копія містить забагато записів.');
  validateDatabaseIdentifiers(database);
  const relationshipIssues = collectDatabaseRelationshipIssues(database);
  if (relationshipIssues.length) throw new Error(`Некоректний зв’язок у резервній копії: ${relationshipIssues[0]}`);
  return database;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  return btoa(binary);
}

function base64ToBytes(value) {
  const encoded = String(value || '');
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('invalid');
  const binary = atob(encoded);
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
  const passwordError = passwordPolicyError(password);
  if (passwordError) throw new Error(`Ненадійний пароль резервної копії. ${passwordError}`);
  validateBackupDatabase(database);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const payload = { format: FORMAT, version: 1, createdAt: new Date().toISOString(), clientCount: Array.isArray(database?.clients) ? database.clients.length : 0, database };
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(payload)));
  const envelope = {
    format: FORMAT, version: VERSION, encrypted: true,
    kdf: { algorithm: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: bytesToBase64(salt) },
    cipher: { algorithm: 'AES-GCM', iv: bytesToBase64(iv) },
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
  if (encoder.encode(JSON.stringify(envelope)).byteLength > MAX_BACKUP_FILE_BYTES) throw new Error('Резервна копія завелика для безпечного збереження.');
  return envelope;
}

export async function decryptBackup(envelope, password) {
  try {
    if (typeof password !== 'string' || !password || password.length > 128) throw new Error('invalid');
    if (!isEncryptedBackup(envelope) || envelope.kdf?.algorithm !== 'PBKDF2' || envelope.kdf?.hash !== 'SHA-256' || envelope.cipher?.algorithm !== 'AES-GCM') throw new Error('invalid');
    const iterations = Number(envelope.kdf.iterations);
    if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000) throw new Error('invalid');
    if (String(envelope.kdf.salt || '').length > 128 || String(envelope.cipher.iv || '').length > 128 || String(envelope.ciphertext || '').length > MAX_BACKUP_FILE_BYTES) throw new Error('invalid');
    const salt = base64ToBytes(envelope.kdf.salt);
    const iv = base64ToBytes(envelope.cipher.iv);
    if (salt.length !== SALT_LENGTH || iv.length !== IV_LENGTH) throw new Error('invalid');
    const key = await deriveKey(password, salt, iterations);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, base64ToBytes(envelope.ciphertext));
    const payload = JSON.parse(decoder.decode(plaintext));
    if (payload?.format !== FORMAT || payload.version !== 1 || !Number.isInteger(payload.clientCount) || payload.clientCount < 0) throw new Error('invalid');
    validateBackupDatabase(payload.database);
    return payload;
  } catch {
    throw new Error('Невірний пароль або пошкоджений файл резервної копії.');
  }
}
