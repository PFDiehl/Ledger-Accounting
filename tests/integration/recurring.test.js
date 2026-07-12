import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import {
  createApp, setupTestEnv, cleanupTestOrg,
  createTestContact, authHeader,
} from '../helpers/testApp.js';
import prisma from '../../src/lib/prisma.js';
import { processRecurringInvoices } from '../../src/routes/recurring.js';

const app = createApp();
let user, org, contact, token;

beforeAll(async () => {
  ({ user, org } = await setupTestEnv());
  contact = await createTestContact(org.id);
  token   = authHeader(user.id).Authorization;
});

afterAll(async () => {
  await prisma.recurringInvoice.deleteMany({ where: { orgId: org.id } });
  await cleanupTestOrg(org.id);
  await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  await prisma.$disconnect();
});

const validSchedule = () => ({
  contactId:     contact.id,
  frequency:     'monthly',
  nextInvoiceAt: '2026-08-01',
  autoSend:      false,
  templateData:  {
    currency:  'USD',
    lineItems: [{ description: 'Monthly retainer', quantity: 1, unitPrice: 3000, taxRate: 0 }],
  },
});

describe('Recurring invoices', () => {
  let scheduleId;

  it('creates a recurring schedule', async () => {
    const res = await request(app)
      .post(`/api/orgs/${org.id}/recurring`)
      .set('Authorization', token)
      .send(validSchedule());

    expect(res.status).toBe(201);
    expect(res.body.data.frequency).toBe('monthly');
    expect(res.body.data.status).toBe('active');
    scheduleId = res.body.data.id;
  });

  it('lists schedules', async () => {
    const res = await request(app)
      .get(`/api/orgs/${org.id}/recurring`)
      .set('Authorization', token);
    expect(res.status).toBe(200);
    expect(res.body.data.some(s => s.id === scheduleId)).toBe(true);
  });

  it('can pause a schedule', async () => {
    const res = await request(app)
      .post(`/api/orgs/${org.id}/recurring/${scheduleId}/pause`)
      .set('Authorization', token);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('paused');
  });

  it('can resume a paused schedule', async () => {
    const res = await request(app)
      .post(`/api/orgs/${org.id}/recurring/${scheduleId}/resume`)
      .set('Authorization', token);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('active');
  });

  it('processes a due schedule and creates an invoice', async () => {
    // Set nextInvoiceAt to yesterday so it's due
    await prisma.recurringInvoice.update({
      where: { id: scheduleId },
      data:  { nextInvoiceAt: new Date('2026-05-01') },
    });

    const results = await processRecurringInvoices();
    const mine = results.find(r => r.scheduleId === scheduleId);
    expect(mine).toBeDefined();
    expect(mine.status).toBe('created');
    expect(mine.invoiceId).toBeTruthy();

    // Schedule should have advanced its next date
    const updated = await prisma.recurringInvoice.findUnique({ where: { id: scheduleId } });
    expect(new Date(updated.nextInvoiceAt).toISOString()).not.toBe(new Date('2026-05-01').toISOString());
    expect(updated.invoicesCreated).toBe(1);
  });

  it('can cancel a schedule', async () => {
    const res = await request(app)
      .delete(`/api/orgs/${org.id}/recurring/${scheduleId}`)
      .set('Authorization', token);
    expect(res.status).toBe(204);

    const get = await request(app)
      .get(`/api/orgs/${org.id}/recurring/${scheduleId}`)
      .set('Authorization', token);
    expect(get.body.data.status).toBe('cancelled');
  });

  it('rejects schedule with no line items', async () => {
    const res = await request(app)
      .post(`/api/orgs/${org.id}/recurring`)
      .set('Authorization', token)
      .send({ ...validSchedule(), templateData: { currency:'USD', lineItems:[] } });
    expect(res.status).toBe(422);
  });
});
