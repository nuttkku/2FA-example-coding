import { z } from 'zod';

const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
});

export const twoFaCodeSchema = z.object({
  code: z.string().min(6).max(9),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: password,
});

export const createUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1).max(255),
  role: z.enum(['admin', 'manager', 'user']),
  temporaryPassword: password,
});

export const updateUserSchema = z.object({
  role: z.enum(['admin', 'manager', 'user']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

export const resetPasswordSchema = z.object({
  temporaryPassword: password,
});
