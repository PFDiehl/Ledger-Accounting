import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import {
  createApp, setupTestEnv, cleanupTestOrg,
  createTestContact, authHeader,
} from '../helpers/testApp.js';
import prisma from '../../src/lib/prisma.js';
import { signPortalToken } from '../../src/routes/portal.js';

const app = createApp();
let user, org, contact, token;

beforeAll(async () => {
  ({ user, org } = await setupTestEnv());
  contact = await createTestContact(org.id);
  token   = authHeader(user.id).Authorization;
});

afterAll(async () => {
  await prisma.exchangeRate.deleteMany({ where: { orgId: org.id } });
  await cleanupTestOrg(org.id);
  await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  await prisma.$disconnect();
});

// ── Currency tests ────────────────────────────────────────────────────────────

describe('Currencies', () => {
  it('lists currencies', async () => {
    const res = await request(app)
      .get(`/api/orgs/${org.id}/currencies`)
      .set('Authorization', token);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(10);
    expect(res.body.data.some(c => c.code === 'USD')).toBe(true);
  });

  it('can add a manual exchange rate', async () => {
    const res = await request(app)
      .post(`/api/orgs/${org.id}/currencies/rates`)
      .set('Authorization', token)
      .send({ fromCurrency: 'USD', toCurrency: 'EUR', rate: 0.92 });
    expect(res.status).toBe(201);
    expect(Number(res.body.data.rate)).toBeCloseTo(0.92, 2);
  });

  it('converts between currencies', async () => {
    const res = await request(app)
      .get(`/api/orgs/${org.id}/currencies/convert?from=USD&to=EUR&amount=1000`)
      .set('Authorization', token);
    expect(res.status).toBe(200);
    expect(res.body.data.from).toBe('USD');
    expect(res.body.data.to).toBe('EUR');
    expect(res.body.data.converted).toBeGreaterThan(0);
    expect(res.body.data.rate).toBeGreaterThan(0);
  });

  it('converts at rate 1 for same currency', async () => {
    const res = await request(app)
      .get(`/api/orgs/${org.id}/currencies/convert?from=USD&to=USD&amount=500`)
      .set('Authorization', token);
    expect(res.status).toBe(200);
    expect(res.body.data.converted).toBe(500);
    expect(res.body.data.rate).toBe(1);
  });

  it('rejects same-currency manual rate', async () => {
    const res = await request(app)
      .post(`/api/orgs/${org.id}/currencies/rates`)
      .set('Authorization', token)
      .send({ fromCurrency: 'USD', toCurrency: 'USD', rate: 1 });
    expect(res.status).toBe(422);
  });

  it('syncs dev rates when no API key is set', async () => {
    const res = await request(app)
      .post(`/api/orgs/${org.id}/currencies/sync`)
      .set('Authorization', token);
    expect(res.status).toBe(200);
    expect(res.body.data.synced).toBeGreaterThan(0);
  });
});

// ── Customer portal tests ─────────────────────────────────────────────────────

describe('Customer portal', () => {
  let invoiceId, portalToken;

  beforeAll(async () => {
    // Create a sent invoice to use in portal tests
    const seq = await prisma.sequence.findUnique({ where: { orgId_name: { orgId: org.id, name: 'invoice' } } });
    const arAcct = await prisma.account.findFirst({ where: { orgId: org.id, subtype: 'accounts_receivable' } });
    const revAcct = await prisma.account.findFirst({ where: { orgId: org.id, subtype: 'operating_revenue'  } });

    const invoice = await prisma.invoice.create({
      data: {
        orgId:         org.id,
        contactId:     contact.id,
        invoiceNumber: `INV-TEST-${Date.now()}`,
        status:        'sent',
        issueDate:     new Date('2026-06-01'),
        dueDate:       new Date('2026-07-01'),
        currency:      'USD',
        subtotal:      1000,
        taxAmount:     0,
        total:         1000,
        amountPaid:    0,
        createdById:   user.id,
      },
    });

    // Create line items
    await prisma.invoiceLineItem.create({
      data: { invoiceId: invoice.id, description: 'Test service', quantity: 1, unitPrice: 1000, amount: 1000, sortOrder: 0 },
    });

    invoiceId  = invoice.id;
    portalToken = signPortalToken(invoiceId, org.id);
  });

  it('loads invoice via public portal endpoint', async () => {
    const res = await request(app)
      .get(`/api/portal/invoices/${portalToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.invoice.id).toBe(invoiceId);
    expect(res.body.data.invoice.status).toBe('sent');
    expect(res.body.data.org.name).toBe(org.name);
    expect(res.body.data.invoice.lineItems).toHaveLength(1);
  });

  it('does not expose sensitive org data via portal', async () => {
    const res = await request(app)
      .get(`/api/portal/invoices/${portalToken}`);

    const orgData = res.body.data.org;
    expect(orgData).not.toHaveProperty('currency');
    // Should only expose name, email, logoUrl
    expect(Object.keys(orgData).sort()).toEqual(['email','logoUrl','name'].sort());
  });

  it('rejects invalid/expired token', async () => {
    const res = await request(app)
      .get('/api/portal/invoices/not-a-valid-token');
    expect(res.status).toBe(410);
  });

  it('rejects payment on already-paid invoice', async () => {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'paid', amountPaid: 1000 } });
    const res = await request(app)
      .post(`/api/portal/invoices/${portalToken}/pay`);
    expect(res.status).toBe(422);
  });
});
