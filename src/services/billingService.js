// Stripe billing for the Ledger SaaS
// Manages subscriptions for orgs using the platform

const PLANS = {
  starter: {
    name:          'Starter',
    priceId:       process.env.STRIPE_PRICE_STARTER  ?? 'price_starter',
    monthlyPrice:  29,
    limits: {
      invoicesPerMonth: 50,
      users:            3,
      bankAccounts:     2,
    },
    features: ['Invoicing','Bills','Expenses','Banking','Basic reports'],
  },
  professional: {
    name:          'Professional',
    priceId:       process.env.STRIPE_PRICE_PRO      ?? 'price_pro',
    monthlyPrice:  79,
    limits: {
      invoicesPerMonth: 500,
      users:            10,
      bankAccounts:     10,
    },
    features: ['Everything in Starter','Payroll','Budgets','Multi-currency','Recurring invoices','Document OCR'],
  },
  business: {
    name:          'Business',
    priceId:       process.env.STRIPE_PRICE_BUSINESS ?? 'price_business',
    monthlyPrice:  199,
    limits: {
      invoicesPerMonth: -1,   // unlimited
      users:            -1,
      bankAccounts:     -1,
    },
    features: ['Everything in Professional','Unlimited users','API access','Priority support','Custom integrations'],
  },
};

export { PLANS };

async function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe not configured');
  const Stripe = (await import('stripe')).default;
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
}

// ── Create or retrieve Stripe customer for an org ─────────────────────────────

export async function getOrCreateStripeCustomer(org, ownerEmail) {
  if (org.stripeCustomerId) return org.stripeCustomerId;

  const stripe   = await getStripe();
  const customer = await stripe.customers.create({
    name:     org.name,
    email:    ownerEmail ?? org.email,
    metadata: { orgId: org.id },
  });

  const prisma = (await import('../lib/prisma.js')).default;
  await prisma.organization.update({
    where: { id: org.id },
    data:  { stripeCustomerId: customer.id },
  });

  return customer.id;
}

// ── Create a checkout session for a plan upgrade ──────────────────────────────

export async function createCheckoutSession(org, planKey, ownerEmail, successUrl, cancelUrl) {
  const plan = PLANS[planKey];
  if (!plan) throw new Error(`Unknown plan: ${planKey}`);

  const stripe     = await getStripe();
  const customerId = await getOrCreateStripeCustomer(org, ownerEmail);

  const session = await stripe.checkout.sessions.create({
    customer:            customerId,
    mode:                'subscription',
    payment_method_types: ['card'],
    line_items: [{
      price:    plan.priceId,
      quantity: 1,
    }],
    subscription_data: {
      metadata: { orgId: org.id, plan: planKey },
    },
    success_url: successUrl,
    cancel_url:  cancelUrl,
    metadata:    { orgId: org.id, plan: planKey },
  });

  return { url: session.url, sessionId: session.id };
}

// ── Create a Stripe Customer Portal session ───────────────────────────────────

export async function createBillingPortalSession(org, returnUrl) {
  const stripe = await getStripe();
  if (!org.stripeCustomerId) throw new Error('No Stripe customer for this org');

  const session = await stripe.billingPortal.sessions.create({
    customer:   org.stripeCustomerId,
    return_url: returnUrl,
  });

  return session.url;
}

// ── Handle Stripe webhook events ──────────────────────────────────────────────

export async function handleStripeWebhook(payload, signature) {
  const stripe = await getStripe();
  const prisma = (await import('../lib/prisma.js')).default;

  let event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, process.env.STRIPE_BILLING_WEBHOOK_SECRET);
  } catch (err) {
    throw new Error(`Webhook signature verification failed: ${err.message}`);
  }

  switch (event.type) {

    case 'checkout.session.completed': {
      const session = event.data.object;
      const orgId   = session.metadata?.orgId;
      const plan    = session.metadata?.plan;
      if (orgId && plan) {
        await prisma.organization.update({
          where: { id: orgId },
          data:  {
            plan,
            planStatus:          'active',
            stripeSubscriptionId: session.subscription,
            trialEndsAt:         null,
          },
        });
        console.log(`[billing] Org ${orgId} subscribed to ${plan}`);
      }
      break;
    }

    case 'customer.subscription.updated': {
      const sub   = event.data.object;
      const orgId = sub.metadata?.orgId;
      if (orgId) {
        await prisma.organization.update({
          where: { id: orgId },
          data:  {
            planStatus: sub.status,
            plan:       sub.metadata?.plan ?? undefined,
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
        console.log(`[billing] Org ${orgId} subscription cancelled`);
      }
      break;
    }

    case 'invoice.payment_failed': {
      const inv   = event.data.object;
      const orgId = (await prisma.organization.findFirst({
        where: { stripeCustomerId: inv.customer },
      }))?.id;
      if (orgId) {
        await prisma.organization.update({
          where: { id: orgId },
          data:  { planStatus: 'past_due' },
        });
      }
      break;
    }
  }

  return { received: true };
}

// ── Plan limit enforcement ────────────────────────────────────────────────────

export async function checkPlanLimit(orgId, resource) {
  const prisma = (await import('../lib/prisma.js')).default;
  const org    = await prisma.organization.findUnique({ where: { id: orgId } });
  const plan   = PLANS[org?.plan ?? 'starter'];
  if (!plan) return { allowed: true };

  const limit = plan.limits[resource];
  if (limit === -1) return { allowed: true }; // unlimited

  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);

  if (resource === 'invoicesPerMonth') {
    const count = await prisma.invoice.count({
      where: { orgId, createdAt: { gte: start } },
    });
    return { allowed: count < limit, used: count, limit };
  }

  if (resource === 'users') {
    const count = await prisma.orgMember.count({ where: { orgId } });
    return { allowed: count < limit, used: count, limit };
  }

  if (resource === 'bankAccounts') {
    const count = await prisma.bankAccount.count({ where: { orgId } });
    return { allowed: count < limit, used: count, limit };
  }

  return { allowed: true };
}
