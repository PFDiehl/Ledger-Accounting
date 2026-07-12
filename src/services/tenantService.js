// Multi-tenant / white-label service
// Tenants are resellers who deploy Ledger under their own brand

import prisma from '../lib/prisma.js';

// ── Theme resolution ──────────────────────────────────────────────────────────
// Given a hostname, find the tenant and return their branding

export async function resolveTenantByDomain(host) {
  // Strip port if present
  const hostname = host.split(':')[0];

  // Check custom domains first
  const domainRecord = await prisma.tenantDomain.findFirst({
    where:   { domain: hostname, verified: true },
    include: { tenant: true },
  });
  if (domainRecord) return domainRecord.tenant;

  // Check subdomain pattern: {slug}.ledger.app
  const subdomainMatch = hostname.match(/^([a-z0-9-]+)\.ledger\.app$/);
  if (subdomainMatch) {
    return prisma.tenant.findUnique({ where: { slug: subdomainMatch[1] } });
  }

  return null; // main Ledger platform
}

// ── Tenant theme CSS variables ────────────────────────────────────────────────

export function buildThemeCSS(tenant) {
  const { primaryColor = '#534AB7', primaryLight, logoUrl, faviconUrl, fontFamily } = tenant;

  // Derive light variant if not provided
  const light = primaryLight ?? lighten(primaryColor, 0.9);

  return `
:root {
  --brand-primary:       ${primaryColor};
  --brand-primary-light: ${light};
  --brand-font:          ${fontFamily ?? 'inherit'};
}
.app-logo::before { content: ''; }
.nav-item.active  { border-left-color: var(--brand-primary); color: var(--brand-primary); background: var(--brand-primary-light); }
.btn-primary      { background: var(--brand-primary); }
.btn-primary:hover{ background: ${darken(primaryColor, 0.1)}; }
`.trim();
}

function lighten(hex, amount) {
  const n = parseInt(hex.replace('#',''), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 0xFF) + (255 - ((n >> 16) & 0xFF)) * amount));
  const g = Math.min(255, Math.round(((n >>  8) & 0xFF) + (255 - ((n >>  8) & 0xFF)) * amount));
  const b = Math.min(255, Math.round(((n >>  0) & 0xFF) + (255 - ((n >>  0) & 0xFF)) * amount));
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

function darken(hex, amount) {
  const n = parseInt(hex.replace('#',''), 16);
  const r = Math.max(0, Math.round(((n >> 16) & 0xFF) * (1 - amount)));
  const g = Math.max(0, Math.round(((n >>  8) & 0xFF) * (1 - amount)));
  const b = Math.max(0, Math.round(((n >>  0) & 0xFF) * (1 - amount)));
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

// ── Tenant onboarding ─────────────────────────────────────────────────────────

export async function createTenant({
  name, slug, ownerEmail, ownerName,
  primaryColor, logoUrl, supportEmail,
  plan = 'reseller_starter',
}) {
  // Validate slug uniqueness
  const existing = await prisma.tenant.findUnique({ where: { slug } });
  if (existing) throw new Error(`Slug '${slug}' is already taken`);

  // Create the tenant and owner user in a transaction
  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name,
        slug,
        primaryColor: primaryColor ?? '#534AB7',
        logoUrl,
        supportEmail: supportEmail ?? ownerEmail,
        plan,
        status:    'trialing',
        trialEndsAt: new Date(Date.now() + 14 * 864e5),
        features: {
          invoicing:    true,
          bills:        true,
          expenses:     true,
          banking:      true,
          reports:      true,
          payroll:      plan !== 'reseller_starter',
          budgets:      plan !== 'reseller_starter',
          multiCurrency:plan !== 'reseller_starter',
          documents:    true,
          ai:           plan === 'reseller_enterprise',
        },
      },
    });

    // Create tenant owner user
    const bcrypt = await import('bcryptjs');
    const tempPassword = Math.random().toString(36).slice(-12);
    const user = await tx.user.create({
      data: {
        fullName:     ownerName,
        email:        ownerEmail,
        passwordHash: await bcrypt.hash(tempPassword, 10),
        status:       'active',
      },
    });

    await tx.tenantMember.create({
      data: { tenantId: tenant.id, userId: user.id, role: 'owner' },
    });

    return { tenant, user, tempPassword };
  });
}

// ── Feature flag check ────────────────────────────────────────────────────────

export async function isTenantFeatureEnabled(tenantId, feature) {
  if (!tenantId) return true; // main platform has all features

  const tenant = await prisma.tenant.findUnique({
    where:  { id: tenantId },
    select: { features: true, status: true },
  });

  if (!tenant || tenant.status === 'suspended') return false;

  const features = tenant.features ?? {};
  return features[feature] !== false; // default to enabled if not explicitly disabled
}

// ── Usage aggregation for tenant billing ─────────────────────────────────────

export async function getTenantUsageSummary(tenantId) {
  const orgs = await prisma.organization.findMany({
    where:  { tenantId },
    select: { id: true, name: true, plan: true },
  });

  const orgIds = orgs.map(o => o.id);

  const [userCount, invoiceCount, activeOrgs] = await Promise.all([
    prisma.orgMember.count({
      where: { orgId: { in: orgIds } },
    }),
    prisma.invoice.count({
      where: { orgId: { in: orgIds }, createdAt: { gte: new Date(Date.now() - 30 * 864e5) } },
    }),
    prisma.organization.count({
      where: { id: { in: orgIds } },
    }),
  ]);

  return {
    tenantId,
    organizations:       activeOrgs,
    totalUsers:          userCount,
    invoicesThisMonth:   invoiceCount,
    orgs: orgs.map(o => ({ id: o.id, name: o.name, plan: o.plan })),
  };
}
