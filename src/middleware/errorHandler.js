import { AppError } from '../lib/errors.js';
import { Prisma } from '@prisma/client';

export function errorHandler(err, req, res, next) {
  // Zod / our own validation errors
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      code:    err.code,
      message: err.message,
      ...(err.errors ? { errors: err.errors } : {}),
    });
  }

  // Prisma unique constraint violation
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const field = err.meta?.target?.[0] ?? 'field';
      return res.status(409).json({
        success: false,
        code:    'CONFLICT',
        message: `A record with that ${field} already exists`,
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({
        success: false,
        code:    'NOT_FOUND',
        message: 'Record not found',
      });
    }
  }

  // Unknown / unexpected errors
  console.error('[Unhandled error]', err);
  return res.status(500).json({
    success: false,
    code:    'INTERNAL_ERROR',
    message: process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred'
      : err.message,
  });
}
