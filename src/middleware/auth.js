import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';

export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success:false, message:'No token provided' });
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'ledger-secret-key-change-me-123');
    req.user = { id: payload.userId || payload.id };
    next();
  } catch(e) {
    return res.status(401).json({ success:false, message:'Invalid or expired access token' });
  }
}

export async function authAndOrg(minRole = 'viewer') {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || '';
      const token = header.replace('Bearer ', '');
      if (!token) return res.status(401).json({ success:false, message:'No token provided' });
      const payload = jwt.verify(token, process.env.JWT_SECRET || 'ledger-secret-key-change-me-123');
      req.user = { id: payload.userId || payload.id };
      req.orgId = req.params.orgId;
      next();
    } catch(e) {
      return res.status(401).json({ success:false, message:'Invalid or expired access token' });
    }
  };
}