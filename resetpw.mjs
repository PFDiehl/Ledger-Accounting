import bcrypt from 'bcryptjs';
import prisma from './src/lib/prisma.js';
const hash = await bcrypt.hash('catdog123', 12);
await prisma.user.update({ where: { email: 'pfd77@pm.me' }, data: { passwordHash: hash } });
console.log('Done! Hash:', hash);
process.exit(0);