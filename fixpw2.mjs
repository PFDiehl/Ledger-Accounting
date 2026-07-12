import bcrypt from 'bcryptjs';
import prisma from './src/lib/prisma.js';
const pw = 'password';
const hash = await bcrypt.hash(pw, 10);
await prisma.user.update({ where: { email: 'pfd77@pm.me' }, data: { passwordHash: hash } });
console.log('Password set to: password');
process.exit(0);