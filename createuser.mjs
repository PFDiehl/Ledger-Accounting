import bcrypt from 'bcryptjs';
import prisma from './src/lib/prisma.js';
const hash = await bcrypt.hash('pass1234', 10);
const existing = await prisma.user.findUnique({ where: { email: 'test@ledger.com' } });
if (existing) {
  await prisma.user.update({ where: { email: 'test@ledger.com' }, data: { passwordHash: hash } });
  console.log('Updated password for test@ledger.com');
} else {
  console.log('User not found - use pfd77@pm.me');
}
await prisma.user.update({ where: { email: 'pfd77@pm.me' }, data: { passwordHash: hash } });
console.log('Also updated pfd77@pm.me password to pass1234');
process.exit(0);