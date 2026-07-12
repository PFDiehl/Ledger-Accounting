import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import {
  createApp, setupTestEnv, cleanupTestOrg,
  createTestContact, authHeader,
} from '../helpers/testApp.js';
import prisma from '../../src/lib/prisma.js';

const app = createApp();
let user, org, contact, token;

beforeAll(async () => {
  ({ user, org } = await setupTestEnv());
  contact = await createTestContact(org.id);
  token   = authHeader(user.id).Authorization;
});

afterAll(async () => {
  await cleanupTestOrg(org.id);
  await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  await prisma.$disconnect();
});

const validInvoice = () => ({
  contactId: contact.id,
  issueDate: '2026-06-01',
  dueDate:   '2026-07-01',
  lineItems: [
    { description: 'Consulting services', quantity: 10, unitPrice: 150, taxRate: 0 },
    { description: 'Expenses',            quantity: 1,  unitPrice: 250, taxRate: 0 },
  ],
});

describe('POST /api/orgs/:orgId/invoices', () => {
  it('creates a draft invoice with correct totals', async () => {
    const res = await request(app)
      .post(`/api/orgs/${org.id}/invoices`)
      .set('Authorization', token)
      .send(validInvoice());

    expect(res.status).toBe(201);
    const inv = res.body.data;
    expect(inv.status).toBe('draft');
    expect(Number(inv.subtotal)).toBe(1750); // 10*150 + 250
    expect(Number(inv.total)).toBe(1750);
    expect(inv.invoiceNumber).toMatch(/^INV-/);
    expect(inv.lineItems).toHaveLength(2);
  });

  it('rejects invoice with no line items', async () => {
    const res = await request(app)
      .post(`/api/orgs/${org.id}/invoices`)
      .set('Authorization', token)
      .send({ ...validInvoice(), lineItems: [] });
    expect(res.status).toBe(422);
  });

  it('rejects invoice for contact from different org', async () => {
    const res = await request(app)
      .post(`/api/orgs/${org.id}/invoices`)
      .set('Authorization', token)
      .send({ ...validInvoice(), contactId: 'a0000000-0000-0000-0000-000000000000' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects without auth', async () => {
    const res = await request(app)
      .post(`/api/orgs/${org.id}/invoices`)
      .send(validInvoice());
    expect(res.status).toBe(401);
  });
});

describe('GET /api/orgs/:orgId/invoices', () => {
  it('lists invoices with pagination meta', async () => {
    const res = await request(app)
      .get(`/api/orgs/${org.id}/invoices`)
      .set('Authorization', token);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty('total');
    expect(res.body.meta).toHaveProperty('pages');
  });

  it('filters by status', async () => {
    // Create a draft invoice
    await request(app)
      .post(`/api/orgs/${org.id}/invoices`)
      .set('Authorization', token)
      .send(validInvoice());

    const res = await request(app)
      .get(`/api/orgs/${org.id}/invoices?status=draft`)
      .set('Authorization', token);

    expect(res.status).toBe(200);
    res.body.data.forEach(inv => expect(inv.status).toBe('draft'));
  });
});

describe('Invoice lifecycle', () => {
  let invoiceId;

  beforeAll(async () => {
    const res = await request(app)
      .post(`/api/orgs/${org.id}/invoices`)
      .set('Authorization', token)
      .send(validInvoice());
    invoiceId = res.body.data.id;
  });

  it('can update a draft invoice', async () => {
    const updated = validInvoice();
    updated.lineItems[0].unitPrice = 200;

    const res = await request(app)
      .put(`/api/orgs/${org.id}/invoices/${invoiceId}`)
      .set('Authorization', token)
      .send(updated);

    expect(res.status).toBe(200);
    // 10*200 + 250 = 2250
    expect(Number(res.body.data.subtotal)).toBe(2250);
  });

  it('sends an invoice (changes status to sent, creates journal entry)', async () => {
    const res = await request(app)
      .post(`/api/orgs/${org.id}/invoices/${invoiceId}/send`)
      .set('Authorization', token);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('sent');
    expect(res.body.data.sentAt).toBeTruthy();
    expect(res.body.data.journalEntryId).toBeTruthy();
  });

  it('cannot edit a sent invoice', async () => {
    const res = await request(app)
      .put(`/api/orgs/${org.id}/invoices/${invoiceId}`)
      .set('Authorization', token)
      .send(validInvoice());
    expect(res.status).toBe(422);
  });

  it('records a partial payment', async () => {
    const res = await request(app)
      .post(`/api/orgs/${org.id}/invoices/${invoiceId}/payment`)
      .set('Authorization', token)
      .send({ amount: 500, method: 'bank_transfer', paymentDate: '2026-06-15' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('partial');
    expect(Number(res.body.data.amountPaid)).toBe(500);
  });

  it('marks as paid when full payment recorded', async () => {
    // Get current amount due
    const getRes = await request(app)
      .get(`/api/orgs/${org.id}/invoices/${invoiceId}`)
      .set('Authorization', token);
    const remaining = Number(getRes.body.data.total) - Number(getRes.body.data.amountPaid);

    const res = await request(app)
      .post(`/api/orgs/${org.id}/invoices/${invoiceId}/payment`)
      .set('Authorization', token)
      .send({ amount: remaining, method: 'bank_transfer', paymentDate: '2026-06-20' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('paid');
  });

  it('cannot void a paid invoice', async () => {
    const res = await request(app)
      .post(`/api/orgs/${org.id}/invoices/${invoiceId}/void`)
      .set('Authorization', token)
      .send({ reason: 'Test void' });
    expect(res.status).toBe(422);
  });
});

describe('Invoice void flow', () => {
  it('can void a draft invoice', async () => {
    const create = await request(app)
      .post(`/api/orgs/${org.id}/invoices`)
      .set('Authorization', token)
      .send(validInvoice());

    const res = await request(app)
      .post(`/api/orgs/${org.id}/invoices/${create.body.data.id}/void`)
      .set('Authorization', token)
      .send({ reason: 'Created by mistake' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('void');
    expect(res.body.data.voidReason).toBe('Created by mistake');
  });
});
