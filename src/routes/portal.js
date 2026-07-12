// Customer Portal — public routes (no auth required)
// Clients access their invoices via a signed token in the URL:
//   /portal/invoices/:token
// The token encodes the invoice ID and org ID, signed with JWT_SECRET.

import { Router } from 'express';
import jwt        from 'jsonwebtoken';
import prisma     from '../lib/prisma.js';
import { asyncHandler, ok, NotFoundError, AppError } from '../lib/errors.js';
import { renderInvoicePDF } from '../services/pdfService.js';

const router = Router();

// ── Token helpers ─────────────────────────────────────────

function signPortalToken(invoiceId, orgId) {
  return jwt.sign({ invoiceId, orgId, type: 'portal' }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

function verifyPortalToken(token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  if (payload.type !== 'portal') throw new Error('Invalid token type');
  return payload;
}

// ── GET /portal/invoices/:token — public invoice view ─────

router.get('/invoices/:token', asyncHandler(async (req, res) => {
  let payload;
  try { payload = verifyPortalToken(req.params.token); }
  catch { throw new AppError('This invoice link has expired or is invalid.', 410); }

  const [invoice, org] = await Promise.all([
    prisma.invoice.findFirst({
      where:   { id: payload.invoiceId, orgId: payload.orgId },
      include: { contact: true, lineItems: { orderBy: { sortOrder: 'asc' } } },
    }),
    prisma.organization.findUnique({ where: { id: payload.orgId } }),
  ]);

  if (!invoice || !org) throw new NotFoundError('Invoice');

  ok(res, {
    invoice: {
      id:            invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status:        invoice.status,
      issueDate:     invoice.issueDate,
      dueDate:       invoice.dueDate,
      currency:      invoice.currency,
      subtotal:      invoice.subtotal,
      taxAmount:     invoice.taxAmount,
      total:         invoice.total,
      amountPaid:    invoice.amountPaid,
      amountDue:     Number(invoice.total) - Number(invoice.amountPaid),
      notes:         invoice.notes,
      lineItems:     invoice.lineItems,
      contact:       { name: invoice.contact.name, email: invoice.contact.email },
    },
    org: { name: org.name, email: org.email, logoUrl: org.logoUrl },
  });
}));

// ── GET /portal/invoices/:token/pdf — download PDF ────────

router.get('/invoices/:token/pdf', asyncHandler(async (req, res) => {
  let payload;
  try { payload = verifyPortalToken(req.params.token); }
  catch { throw new AppError('This invoice link has expired.', 410); }

  const [invoice, org] = await Promise.all([
    prisma.invoice.findFirst({
      where:   { id: payload.invoiceId, orgId: payload.orgId },
      include: { contact: true, lineItems: { orderBy: { sortOrder: 'asc' } } },
    }),
    prisma.organization.findUnique({ where: { id: payload.orgId } }),
  ]);
  if (!invoice || !org) throw new NotFoundError('Invoice');

  const pdf = await renderInvoicePDF(invoice, org);
  res.setHeader('Content-Type',        'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${invoice.invoiceNumber}.pdf"`);
  res.end(pdf);
}));

// ── POST /portal/invoices/:token/pay — create Stripe PaymentIntent ──

router.post('/invoices/:token/pay', asyncHandler(async (req, res) => {
  let payload;
  try { payload = verifyPortalToken(req.params.token); }
  catch { throw new AppError('This invoice link has expired.', 410); }

  const invoice = await prisma.invoice.findFirst({
    where:   { id: payload.invoiceId, orgId: payload.orgId },
    include: { contact: true },
  });
  if (!invoice) throw new NotFoundError('Invoice');

  if (!['sent','partial','overdue'].includes(invoice.status)) {
    throw new AppError('This invoice is not payable.', 422);
  }

  const amountDue = Number(invoice.total) - Number(invoice.amountPaid);
  if (amountDue <= 0) throw new AppError('This invoice has already been paid.', 422);

  if (!process.env.STRIPE_SECRET_KEY) {
    throw new AppError('Payment processing is not configured.', 503);
  }

  // Dynamically import Stripe to avoid requiring it when not configured
  const Stripe = (await import('stripe')).default;
  const stripe  = new Stripe(process.env.STRIPE_SECRET_KEY);

  const amountCents = Math.round(amountDue * 100);

  const paymentIntent = await stripe.paymentIntents.create({
    amount:      amountCents,
    currency:    (invoice.currency ?? 'USD').toLowerCase(),
    description: `Invoice ${invoice.invoiceNumber} — ${invoice.contact.name}`,
    metadata: {
      invoiceId:     invoice.id,
      orgId:         payload.orgId,
      invoiceNumber: invoice.invoiceNumber,
    },
    automatic_payment_methods: { enabled: true },
  });

  ok(res, { clientSecret: paymentIntent.client_secret, amountDue });
}));

// ── POST /portal/stripe/webhook — Stripe webhook for payment confirmation ──

router.post('/stripe/webhook',
  // Raw body needed for Stripe signature verification
  (req, res, next) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => { req.rawBody = data; next(); });
  },
  asyncHandler(async (req, res) => {
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      return res.status(200).json({ received: true }); // ignore if not configured
    }

    const Stripe = (await import('stripe')).default;
    const stripe  = new Stripe(process.env.STRIPE_SECRET_KEY);

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        req.headers['stripe-signature'],
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'payment_intent.succeeded') {
      const pi        = event.data.object;
      const invoiceId = pi.metadata?.invoiceId;
      const orgId     = pi.metadata?.orgId;
      const amount    = pi.amount / 100;

      if (invoiceId && orgId) {
        const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, orgId } });
        if (invoice) {
          const newPaid = Number(invoice.amountPaid) + amount;
          const isPaid  = newPaid >= Number(invoice.total);
          await prisma.invoice.update({
            where: { id: invoiceId },
            data:  {
              amountPaid: newPaid,
              status:     isPaid ? 'paid' : 'partial',
              paidAt:     isPaid ? new Date() : null,
            },
          });

          // Record the payment
          await prisma.payment.create({
            data: {
              orgId,
              type:        'incoming',
              contactId:   invoice.contactId,
              amount,
              currency:    invoice.currency,
              paymentDate: new Date(),
              method:      'stripe',
              reference:   pi.id,
              createdById: (await prisma.orgMember.findFirst({ where: { orgId, role: 'owner' } }))?.userId ?? orgId,
              allocations: { create: { invoiceId, amount } },
            },
          });
        }
      }
    }

    res.json({ received: true });
  })
);

// ── Helper: generate portal URL for an invoice ────────────

export function invoicePortalUrl(invoice) {
  const token = signPortalToken(invoice.id, invoice.orgId);
  return `${process.env.FRONTEND_URL}/portal/${token}`;
}

export { signPortalToken };
export default router;
