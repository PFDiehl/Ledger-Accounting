import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/tokens.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { registerSchema, loginSchema } from '../lib/schemas.js';
import { asyncHandler, ok, created, UnauthorizedError, AppError } from '../lib/errors.js';

const router = Router();

// POST /auth/register
// Creates a user + their first organization
router.post('/register',
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { fullName, email, password, orgName } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new AppError('Email already in use', 409, 'CONFLICT');

    const passwordHash = await bcrypt.hash(password, 12);
    const slug = orgName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');

    const { user, org } = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { fullName, email, passwordHash },
        select: { id: true, email: true, fullName: true },
      });

      const org = await tx.organization.create({
        data: {
          name:    orgName,
          slug:    `${slug}-${Date.now()}`,
          email,
          members: { create: { userId: user.id, role: 'owner' } },
          sequences: {
            createMany: {
              data: [
                { name: 'invoice', prefix: 'INV-', nextVal: 1001 },
                { name: 'bill',    prefix: 'BILL-', nextVal: 1001 },
                { name: 'journal', prefix: 'JE-',   nextVal: 1    },
              ],
            },
          },
        },
      });

      return { user, org };
    });

    const accessToken  = signAccessToken({ userId: user.id });
    const refreshToken = signRefreshToken({ userId: user.id });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge:   30 * 24 * 60 * 60 * 1000, // 30 days
    });

    created(res, { user, org, accessToken });
  })
);

// POST /auth/login
router.post('/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) throw new UnauthorizedError('Invalid credentials');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedError('Invalid credentials');

    if (user.status !== 'active') throw new UnauthorizedError('Account is inactive');

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data:  { updatedAt: new Date() },
    });

    // Get user's orgs
    const memberships = await prisma.orgMember.findMany({
      where:   { userId: user.id },
      include: { org: { select: { id: true, name: true, slug: true, currency: true } } },
    });

    const accessToken  = signAccessToken({ userId: user.id });
    const refreshToken = signRefreshToken({ userId: user.id });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge:   30 * 24 * 60 * 60 * 1000,
    });

    ok(res, {
      user:     { id: user.id, email: user.email, fullName: user.fullName },
      orgs:     memberships.map((m) => ({ ...m.org, role: m.role })),
      accessToken,
    });
  })
);

// POST /auth/refresh
router.post('/refresh',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.refreshToken;
    if (!token) throw new UnauthorizedError('No refresh token');

    const payload = verifyRefreshToken(token);
    const user    = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || user.status !== 'active') throw new UnauthorizedError('User not found');

    const accessToken = signAccessToken({ userId: user.id });
    ok(res, { accessToken });
  })
);

// POST /auth/logout
router.post('/logout', authenticate, asyncHandler(async (req, res) => {
  res.clearCookie('refreshToken');
  ok(res, { message: 'Logged out' });
}));

// GET /auth/me
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const memberships = await prisma.orgMember.findMany({
    where:   { userId: req.user.id },
    include: { org: { select: { id: true, name: true, slug: true, currency: true } } },
  });
  ok(res, {
    user: req.user,
    orgs: memberships.map((m) => ({ ...m.org, role: m.role })),
  });
}));

export default router;

// PATCH /api/auth/theme  — save personal theme preference
router.patch('/theme',
  authenticate,
  asyncHandler(async (req, res) => {
    const { theme } = req.body;
    const allowed = ['default','sage','slate','ocean'];
    if (!allowed.includes(theme)) throw new AppError('Invalid theme', 422);
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data:  { theme },
      select:{ id: true, fullName: true, email: true, theme: true },
    });
    ok(res, user);
  })
);

// PATCH /api/orgs/:orgId/theme  — save org-level theme (used for invoices/portal)
router.patch('/orgs/:orgId/theme',
  asyncHandler(async (req, res) => {
    const { theme } = req.body;
    const allowed = ['default','sage','slate','ocean'];
    if (!allowed.includes(theme)) throw new AppError('Invalid theme', 422);
    const org = await prisma.organization.update({
      where: { id: req.params.orgId },
      data:  { theme },
    });
    ok(res, org);
  })
);

