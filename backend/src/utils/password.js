import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

export async function hashSecret(plainText) {
  return bcrypt.hash(plainText, SALT_ROUNDS);
}

export async function verifySecret(plainText, hash) {
  return bcrypt.compare(plainText, hash);
}
