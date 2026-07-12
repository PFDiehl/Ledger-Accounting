import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import {
  createApp, setupTestEnv, cleanupTestOrg,
  createTestContact, authHeader,
} from '../helpers/testApp.js';
import prisma from '../../src/lib/prisma.js';

const app = createApp();
let user, org, token;

beforeAll(async () => {
  ({ user, org } = await setupTestEnv());
  token = authHeader(user.id).Authorization;

  // Seed a posted journal entry so reports have data
  const contact = await createTestContact(org.id);
  const arAcct  = await prisma.account.findFirst({ where: { orgId: org.id, subtype: 'accounts_receivable' } });
  const revAcct = await prisma.account.findFirst({ where: { orgId: org.id, subtype: 'operating_revenue'   } });

  if (arAcct && revAcct) {
    await prisma.journalEntry.create({
      data: {
        orgId: org.id, entryNumber: 'JE-0001', date: new Date('2026-06-01'),
        description: 'Test invoice posting', source: 'manual',
        status: 'posted', createdById: user.id, postedAt: new Date(),
        lines: {
          createMany: {
            data: [
              { accountId: arAcct.id,  debit: 5000, credit: 0    },
              { accountId: revAcct.id, debit: 0,    credit: 5000 },
            ],
          },
        },
      },
    });
  }
});

afterAll(async () => {
  await cleanupTestOrg(org.id);
  await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  await prisma.$disconnect();
});

describe('GET /api/orgs/:orgId/reports/pl', () => {
  it('returns P&L with revenue and expenses sections', async () => {
    const res = await request(app)
      .get(`/api/orgs/${org.id}/reports/pl?from=2026-01-01&to=2026-12-31`)
      .set('Authorization', token);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('revenue');
    expect(res.body.data).toHaveProperty('expenses');
    expect(res.body.data).toHaveProperty('netProfit');
    expect(res.body.data.revenue).toHaveProperty('total');
    expect(res.body.data.revenue.total).toBeGreaterThanOrEqual(0);
  });

  it('requires from and to parameters', async () => {
    const res = await request(app)
      .get(`/api/orgs/${org.id}/reports/pl`)
      .set('Authorization', token);
    expect(res.status).toBe(422);
  });

  it('shows seeded revenue in the correct period', async () => {
    const res = await request(app)
      .get(`/api/orgs/${org.id}/reports/pl?from=2026-06-01&to=2026-06-30`)
      .set('Authorization', token);

    expect(res.status).toBe(200);
    // Our seeded entry has $5000 credit to revenue
    expect(res.body.data.revenue.total).toBeGreaterThanOrEqual(5000);
    // netProfit = revenue - expenses
    expect(res.body.data.netProfit).toBe(
      res.body.data.revenue.total - res.body.data.expenses.total
    );
  });
});

describe('GET /api/orgs/:orgId/reports/balance-sheet', () => {
  it('returns assets, liabilities, and equity', async () => {
    const res = await request(app)
      .get(`/api/orgs/${org.id}/reports/balance-sheet?asOf=2026-12-31`)
      .set('Authorization', token);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('assets');
    expect(res.body.data).toHaveProperty('liabilities');
    expect(res.body.data).toHaveProperty('equity');
    expect(res.body.data.assets).toHaveProperty('total');
  });

  it('uses current date when asOf is omitted', async () => {
    const res = await request(app)
      .get(`/api/orgs/${org.id}/reports/balance-sheet`)
      .set('Authorization', token);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/orgs/:orgId/reports/aged-ar', () => {
  it('returns buckets: current, 1_30, 31_60, 61_90, over_90', async () => {
    const res = await request(app)
      .get(`/api/orgs/${org.id}/reports/aged-ar`)
      .set('Authorization', token);

    expect(res.status).toBe(200);
    const { buckets } = res.body.data;
    expect(buckets).toHaveProperty('current');
    expect(buckets).toHaveProperty('1_30');
    expect(buckets).toHaveProperty('31_60');
    expect(buckets).toHaveProperty('61_90');
    expect(buckets).toHaveProperty('over_90');
    Object.values(buckets).forEach(b => {
      expect(b).toHaveProperty('items');
      expect(b).toHaveProperty('total');
      expect(Array.isArray(b.items)).toBe(true);
    });
  });
});

describe('GET /api/orgs/:orgId/reports/dashboard', () => {
  it('returns KPI summary for a date range', async () => {
    const res = await request(app)
      .get(`/api/orgs/${org.id}/reports/dashboard?from=2026-06-01&to=2026-06-30`)
      .set('Authorization', token);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('revenue');
    expect(res.body.data).toHaveProperty('expenses');
    expect(res.body.data).toHaveProperty('netProfit');
    expect(res.body.data).toHaveProperty('outstandingAR');
  });
});
