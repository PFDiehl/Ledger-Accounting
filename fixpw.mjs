import bcrypt from 'bcryptjs';
import prisma from './src/lib/prisma.js';
const pw = 'ledger2024';
const hash = await bcrypt.hash(pw, 10);
await prisma.user.update({ where: { email: 'pfd77@pm.me' }, data: { passwordHash: hash } });
const check = await bcrypt.compare(pw, hash);
console.log('Password set to: ledger2024');
console.log('Verify works:', check);
process.exit(0);