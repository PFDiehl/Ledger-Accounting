// Stripe Connect service
// Resellers connect their Stripe account via OAuth.
// Client subscriptions flow through the connected account;
// Ledger takes a platform fee via application_fee_amount.

async function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not configured');
  const Stripe = (await import('stripe')).default;
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
}

// Platform fee: 20% of subscription revenue
const PLATFORM_FEE_PCT = 0.20;

// ── Reseller Connect onboarding ───────────────────────────────────────────────

export async function createConnectOnboardingLink(tenantId, tenantName, email, returnUrl) {
  const stripe = await getStripe();
  const prisma  = (await import('../lib/prisma.js')).default;

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });

  // Create Stripe Connect account if not already linked
  let accountId = tenant?.stripeConnectId;

  if (!accountId) {
    const account = await stripe.accounts.create({
      type:         'standard',
      email,
      business_type:'company',
      company:      { name: tenantName },
      metadata:     { tenantId },
    });
    accountId = account.id;

    await prisma.tenant.update({
      where: { id: tenantId },
      data:  { stripeConnectId: accountId },
    });
  }

  // Generate onboarding link
  const link = await stripe.accountLinks.create({
    account:     accountId,
    refresh_url: `${returnUrl}?retry=1`,
    return_url:  returnUrl,
    type:        'account_onboarding',
  });

  return { url: link.url, accountId };
}

// ── Check Connect account status ──────────────────────────────────────────────

export async function getConnectAccountStatus(stripeConnectId) {
  const stripe  = await getStripe();
  const account = await stripe.accounts.retrieve(stripeConnectId);
  return {
    id:              account.id,
    chargesEnabled:  account.charges_enabled,
    payoutsEnabled:  account.payouts_enabled,
    detailsSubmitted:account.details_submitted,
    email:           account.email,
    country:         account.country,
    currency:        account.default_currency,
  };
}

// ── Create checkout session on behalf of connected account ───────────────────
// The subscription goes to the reseller; Ledger takes a platform fee

export async function createConnectedCheckout({
  tenantId,
  orgId,
  planKey,
  customerEmail,
  successUrl,
  cancelUrl,
}) {
  const stripe = await getStripe();
  const prisma  = (await import('../lib/prisma.js')).default;

  const [tenant, org] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId } }),
    prisma.organization.findUnique({ where: { id: orgId } }),
  ]);

  if (!tenant?.stripeConnectId) throw new Error('Tenant has not completed Stripe Connect onboarding');

  // Tenant-specific price ID (they set their own prices in their Stripe dashboard)
  const priceId = tenant.stripePriceIds?.[planKey];
  if (!priceId) throw new Error(`No price configured for plan: ${planKey}`);

  // Get or create Stripe customer on the connected account
  let customerId = org?.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create(
      { email: customerEmail, metadata: { orgId } },
      { stripeAccount: tenant.stripeConnectId }
    );
    customerId = customer.id;
    await prisma.organization.update({ where: { id: orgId }, data: { stripeCustomerId: customerId } });
  }

  const session = await stripe.checkout.sessions.create(
    {
      customer:               customerId,
      mode:                   'subscription',
      payment_method_types:   ['card'],
      line_items:             [{ price: priceId, quantity: 1 }],
      subscription_data: {
        application_fee_percent: PLATFORM_FEE_PCT * 100, // 20% to Ledger
        metadata:                { orgId, tenantId, planKey },
      },
      success_url: successUrl,
      cancel_url:  cancelUrl,
      metadata:    { orgId, tenantId, planKey },
    },
    { stripeAccount: tenant.stripeConnectId }
  );

  return { url: session.url, sessionId: session.id };
}

// ── Handle Connect webhooks ────────────────────────────────────────────────────

export async function handleConnectWebhook(payload, signature) {
  const stripe = await getStripe();
  const prisma  = (await import('../lib/prisma.js')).default;

  const event = stripe.webhooks.constructEvent(
    payload,
    signature,
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  );

  const connectedAccountId = event.account; // which reseller this event is for

  const tenant = connectedAccountId
    ? await prisma.tenant.findFirst({ where: { stripeConnectId: connectedAccountId } })
    : null;

  switch (event.type) {

    case 'checkout.session.completed': {
      const session = event.data.object;
      const { orgId, tenantId, planKey } = session.metadata ?? {};
      if (orgId && planKey) {
        await prisma.organization.update({
          where: { id: orgId },
          data: {
            plan:                 planKey,
            planStatus:           'active',
            stripeSubscriptionId: session.subscription,
          },
        });
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub   = event.data.object;
      const orgId = sub.metadata?.orgId;
      if (orgId) {
        await prisma.organization.update({
          where: { id: orgId },
          data:  { plan: 'free', planStatus: 'cancelled' },
        });
      }
      break;
    }

    case 'account.updated': {
      // Connected account completed onboarding
      const account = event.data.object;
      if (tenant && account.charges_enabled) {
        await prisma.tenant.update({
          where: { id: tenant.id },
          data:  { stripeConnectStatus: 'active' },
        });
      }
      break;
    }
  }

  return { received: true, type: event.type };
}

// ── Tenant revenue dashboard ──────────────────────────────────────────────────

export async function getTenantRevenueStats(tenantId) {
  const prisma  = (await import('../lib/prisma.js')).default;
  const tenant  = await prisma.tenant.findUnique({ where: { id: tenantId } });

  if (!tenant?.stripeConnectId) return { error: 'Stripe not connected' };

  const stripe = await getStripe();

  const [balance, payouts] = await Promise.all([
    stripe.balance.retrieve({ stripeAccount: tenant.stripeConnectId }),
    stripe.payouts.list({ limit: 5 }, { stripeAccount: tenant.stripeConnectId }),
  ]);

  const available = balance.available.reduce((s, b) => s + b.amount, 0) / 100;
  const pending   = balance.pending.reduce((s, b) => s + b.amount, 0) / 100;

  return {
    available,
    pending,
    currency:      balance.available[0]?.currency?.toUpperCase() ?? 'USD',
    recentPayouts: payouts.data.map(p => ({
      amount:   p.amount / 100,
      currency: p.currency.toUpperCase(),
      status:   p.status,
      arrivalDate: new Date(p.arrival_date * 1000).toISOString().slice(0,10),
    })),
  };
}
