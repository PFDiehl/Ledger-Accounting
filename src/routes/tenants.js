import { Router }  from 'express';
import prisma       from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { validate }     from '../middleware/validate.js';
import { asyncHandler, ok, created, NotFoundError, AppError } from '../lib/errors.js';
import {
  createTenant, resolveTenantByDomain,
  buildThemeCSS, getTenantUsageSummary,
  isTenantFeatureEnabled,
} from '../services/tenantService.js';
import { z } from 'zod';

const router = Router();

// ── Tenant middleware ─────────────────────────────────────────────────────────

function requireTenantRole(minRole = 'member') {
  const ROLES = ['viewer','member','accountant','admin','owner'];
  return async (req, res, next) => {
    const tenantId = req.params.tenantId;
    const member   = await prisma.tenantMember.findFirst({
      where: { tenantId, userId: req.user.id },
    });
    if (!member) return res.status(403).json({ success:false, message:'Not a tenant member' });
    if (ROLES.indexOf(member.role) < ROLES.indexOf(minRole)) {
      return res.status(403).json({ success:false, message:`Requires ${minRole} role` });
    }
    req.tenantId   = tenantId;
    req.tenantRole = member.role;
    next();
  };
}

// ── Theme endpoint (public — no auth) ────────────────────────────────────────

router.get('/theme', asyncHandler(async (req, res) => {
  const host   = req.headers.host ?? '';
  const tenant = await resolveTenantByDomain(host);

  if (!tenant) {
    return res.json({ success:true, data: null }); // main platform
  }

  res.json({
    success: true,
    data: {
      name:         tenant.name,
      slug:         tenant.slug,
      logoUrl:      tenant.logoUrl,
      faviconUrl:   tenant.faviconUrl,
      primaryColor: tenant.primaryColor,
      supportEmail: tenant.supportEmail,
      features:     tenant.features,
      css:          buildThemeCSS(tenant),
    },
  });
}));

// ── Create a new tenant (platform admin or self-signup) ───────────────────────

router.post('/',
  asyncHandler(async (req, res) => {
    const { name, slug, ownerEmail, ownerName, primaryColor, logoUrl, supportEmail } = req.body;
    if (!name || !slug || !ownerEmail || !ownerName) {
      throw new AppError('name, slug, ownerEmail, and ownerName are required', 422);
    }

    const result = await createTenant({ name, slug, ownerEmail, ownerName, primaryColor, logoUrl, supportEmail });

    created(res, {
      tenant:       result.tenant,
      owner:        { id: result.user.id, email: result.user.email },
      tempPassword: result.tempPassword, // show once — user should change immediately
    });
  })
);

// ── Tenant management (requires tenant membership) ────────────────────────────

// GET /tenants/:tenantId
router.get('/:tenantId',
  authenticate,
  requireTenantRole('member'),
  asyncHandler(async (req, res) => {
    const tenant = await prisma.tenant.findUnique({
      where:   { id: req.tenantId },
      include: { domains: { where: { verified: true } } },
    });
    if (!tenant) throw new NotFoundError('Tenant');
    ok(res, tenant);
  })
);

// PATCH /tenants/:tenantId/branding
router.patch('/:tenantId/branding',
  authenticate,
  requireTenantRole('admin'),
  validate(z.object({
    name:         z.string().min(1).optional(),
    logoUrl:      z.string().url().optional(),
    faviconUrl:   z.string().url().optional(),
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    supportEmail: z.string().email().optional(),
    fontFamily:   z.string().optional(),
    footerText:   z.string().optional(),
  })),
  asyncHandler(async (req, res) => {
    const tenant = await prisma.tenant.update({
      where: { id: req.tenantId },
      data:  req.body,
    });
    ok(res, { ...tenant, css: buildThemeCSS(tenant) });
  })
);

// PATCH /tenants/:tenantId/features
router.patch('/:tenantId/features',
  authenticate,
  requireTenantRole('admin'),
  validate(z.object({
    features: z.record(z.boolean()),
  })),
  asyncHandler(async (req, res) => {
    const tenant = await prisma.tenant.update({
      where: { id: req.tenantId },
      data:  { features: req.body.features },
    });
    ok(res, tenant.features);
  })
);

// ── Custom domains ────────────────────────────────────────────────────────────

router.post('/:tenantId/domains',
  authenticate,
  requireTenantRole('admin'),
  validate(z.object({ domain: z.string().min(3) })),
  asyncHandler(async (req, res) => {
    const { domain } = req.body;

    // Generate DNS verification token
    const verificationToken = `ledger-verify-${Math.random().toString(36).slice(2,12)}`;

    const record = await prisma.tenantDomain.create({
      data: {
        tenantId:          req.tenantId,
        domain,
        verificationToken,
        verified:          false,
      },
    });

    ok(res, {
      ...record,
      instructions: `Add a TXT record: ${verificationToken} to ${domain} DNS to verify ownership.`,
    });
  })
);

router.post('/:tenantId/domains/:domainId/verify',
  authenticate,
  requireTenantRole('admin'),
  asyncHandler(async (req, res) => {
    const record = await prisma.tenantDomain.findFirst({
      where: { id: req.params.domainId, tenantId: req.tenantId },
    });
    if (!record) throw new NotFoundError('Domain');

    // DNS TXT record lookup
    let verified = false;
    try {
      const dns = await import('dns/promises');
      const txtRecords = await dns.resolveTxt(record.domain);
      verified = txtRecords.flat().includes(record.verificationToken);
    } catch { /* DNS lookup failed */ }

    if (!verified) {
      return ok(res, { verified: false, message: 'TXT record not found yet. DNS can take up to 48 hours to propagate.' });
    }

    await prisma.tenantDomain.update({
      where: { id: record.id },
      data:  { verified: true, verifiedAt: new Date() },
    });

    ok(res, { verified: true, message: 'Domain verified successfully!' });
  })
);

// ── Client org management ─────────────────────────────────────────────────────

router.get('/:tenantId/clients',
  authenticate,
  requireTenantRole('member'),
  asyncHandler(async (req, res) => {
    const orgs = await prisma.organization.findMany({
      where:   { tenantId: req.tenantId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { members: true } } },
    });
    ok(res, orgs);
  })
);

router.post('/:tenantId/clients',
  authenticate,
  requireTenantRole('admin'),
  validate(z.object({
    name:          z.string().min(1),
    email:         z.string().email(),
    ownerName:     z.string().min(1),
    plan:          z.string().optional(),
    currency:      z.string().length(3).default('USD'),
  })),
  asyncHandler(async (req, res) => {
    const bcrypt = await import('bcryptjs');
    const tempPw = Math.random().toString(36).slice(-10);

    const result = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          tenantId: req.tenantId,
          name:     req.body.name,
          slug:     req.body.name.toLowerCase().replace(/[^a-z0-9]/g,'-').slice(0,50) + '-' + Date.now(),
          email:    req.body.email,
          currency: req.body.currency,
          plan:     req.body.plan ?? 'starter',
        },
      });
      const user = await tx.user.create({
        data: {
          fullName:     req.body.ownerName,
          email:        req.body.email,
          passwordHash: await bcrypt.hash(tempPw, 10),
          status:       'active',
        },
      });
      await tx.orgMember.create({ data: { orgId: org.id, userId: user.id, role: 'owner' } });
      return { org, userId: user.id };
    });

    created(res, { org: result.org, tempPassword: tempPw });
  })
);

// ── Usage dashboard ───────────────────────────────────────────────────────────

router.get('/:tenantId/usage',
  authenticate,
  requireTenantRole('member'),
  asyncHandler(async (req, res) => {
    const summary = await getTenantUsageSummary(req.tenantId);
    ok(res, summary);
  })
);

export default router;
