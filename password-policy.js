export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

const COMMON_PASSWORDS = new Set([
  '123456789012',
  'adminadminadmin',
  'password1234',
  'qwerty123456',
  'harmony12345',
]);

/** Returns a user-facing validation error, or an empty string for a strong password. */
export function passwordPolicyError(password, login = '') {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Пароль має містити щонайменше ${MIN_PASSWORD_LENGTH} символів.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Пароль має містити не більше ${MAX_PASSWORD_LENGTH} символів.`;
  }

  const normalized = password.normalize('NFKC').toLocaleLowerCase('uk-UA');
  const normalizedLogin = String(login || '').trim().normalize('NFKC').toLocaleLowerCase('uk-UA');
  if (COMMON_PASSWORDS.has(normalized) || /^(.{1,4})\1+$/u.test(normalized)) {
    return 'Оберіть менш передбачуваний пароль.';
  }
  if (normalizedLogin.length >= 3 && normalized.includes(normalizedLogin)) {
    return 'Пароль не повинен містити логін користувача.';
  }

  const characterGroups = [
    /\p{Ll}/u,
    /\p{Lu}/u,
    /\p{N}/u,
    /[^\p{L}\p{N}\s]/u,
  ].filter((pattern) => pattern.test(password)).length;
  if (password.length < 16 && characterGroups < 3) {
    return 'Використайте щонайменше три групи символів: малі й великі літери, цифри або спеціальні знаки; або парольну фразу від 16 символів.';
  }
  return '';
}
