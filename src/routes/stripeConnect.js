import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { validate }     from '../middleware/validate.js';
import { asyncHandler, ok, created, AppError } from '../lib/errors.js';
import {
  createConnectOnboardingLink,
  getConnectAccountStatus,
  createConnectedCheckout,
  handleConnectWebhook,
  getTenantRevenueStats,
} from '../services/stripeConnectService.js';
import prisma from '../lib/prisma.js';
import { z } from 'zod';

const router = Router();

// ── Tenant Stripe Connect setup ───────────────────────────────────────────────

// POST /connect/tenants/:tenantId/onboard
// Start Stripe Connect OAuth for a reseller
router.post('/tenants/:tenantId/onboard',
  authenticate,
  asyncHandler(async (req, res) => {
    const { tenantId } = req.params;
    const member = await prisma.tenantMember.findFirst({
      where: { tenantId, userId: req.user.id, role: { in: ['admin','owner'] } },
    });
    if (!member) throw new AppError('Not authorized for this tenant', 403);

    const tenant      = await prisma.tenant.findUnique({ where: { id: tenantId } });
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    const returnUrl   = `${frontendUrl}/tenant/settings/billing?connected=1`;

    const { url } = await createConnectOnboardingLink(
      tenantId, tenant.name, req.user.email, returnUrl
    );

    ok(res, { url });
  })
);

// GET /connect/tenants/:tenantId/status
router.get('/tenants/:tenantId/status',
  authenticate,
  asyncHandler(async (req, res) => {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.tenantId } });
    if (!tenant?.stripeConnectId) {
      return ok(res, { connected: false });
    }
    const status = await getConnectAccountStatus(tenant.stripeConnectId);
    ok(res, { connected: true, ...status });
  })
);

// GET /connect/tenants/:tenantId/revenue
router.get('/tenants/:tenantId/revenue',
  authenticate,
  asyncHandler(async (req, res) => {
    const stats = await getTenantRevenueStats(req.params.tenantId);
    ok(res, stats);
  })
);

// ── Tenant pricing configuration ──────────────────────────────────────────────

// PATCH /connect/tenants/:tenantId/pricing
// Resellers set their own price IDs from their Stripe dashboard
router.patch('/tenants/:tenantId/pricing',
  authenticate,
  validate(z.object({
    stripePriceIds: z.record(z.string()), // { starter: 'price_xxx', professional: 'price_yyy' }
  })),
  asyncHandler(async (req, res) => {
    const member = await prisma.tenantMember.findFirst({
      where: { tenantId: req.params.tenantId, userId: req.user.id, role: { in: ['admin','owner'] } },
    });
    if (!member) throw new AppError('Not authorized', 403);

    const tenant = await prisma.tenant.update({
      where: { id: req.params.tenantId },
      data:  { stripePriceIds: req.body.stripePriceIds },
    });
    ok(res, { stripePriceIds: tenant.stripePriceIds });
  })
);

// ── Client subscription checkout ──────────────────────────────────────────────

// POST /connect/orgs/:orgId/checkout
// A client org subscribes to a plan through the reseller's Stripe account
router.post('/orgs/:orgId/checkout',
  authenticate,
  validate(z.object({
    planKey:    z.string(),
    tenantId:   z.string().uuid(),
  })),
  asyncHandler(async (req, res) => {
    const org = await prisma.organization.findUnique({ where: { id: req.params.orgId } });
    if (!org) throw new AppError('Organization not found', 404);

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';

    const { url } = await createConnectedCheckout({
      tenantId:     req.body.tenantId,
      orgId:        req.params.orgId,
      planKey:      req.body.planKey,
      customerEmail:req.user.email,
      successUrl:   `${frontendUrl}/settings/billing?success=1`,
      cancelUrl:    `${frontendUrl}/settings/billing`,
    });

    ok(res, { url });
  })
);

// ── Connect webhook ───────────────────────────────────────────────────────────

router.post('/webhook',
  (req, res, next) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', c => { data += c; });
    req.on('end',  () => { req.rawBody = data; next(); });
  },
  asyncHandler(async (req, res) => {
    const sig    = req.headers['stripe-signature'];
    const result = await handleConnectWebhook(req.rawBody, sig);
    res.json(result);
  })
);

export default router;
