import jwt from 'jsonwebtoken';
import { UnauthorizedError } from './errors.js';

const {
  JWT_SECRET,
  JWT_EXPIRES_IN         = '15m',
  REFRESH_TOKEN_SECRET,
  REFRESH_TOKEN_EXPIRES_IN = '30d',
} = process.env;

export function signAccessToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function signRefreshToken(payload) {
  return jwt.sign(payload, REFRESH_TOKEN_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRES_IN,
  });
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    throw new UnauthorizedError('Invalid or expired access token');
  }
}

export function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, REFRESH_TOKEN_SECRET);
  } catch {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }
}
