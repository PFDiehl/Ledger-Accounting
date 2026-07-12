import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import {
  createApp, setupTestEnv, cleanupTestOrg, authHeader,
} from '../helpers/testApp.js';
import prisma from '../../src/lib/prisma.js';

const app = createApp();
let user, org, token, accountId;

beforeAll(async () => {
  ({ user, org } = await setupTestEnv());
  token = authHeader(user.id).Authorization;
  const acct = await prisma.account.findFirst({ where: { orgId: org.id, type: 'expense' } });
  accountId = acct?.id;
});

afterAll(async () => {
  await prisma.budgetLine.deleteMany({ where: { budget: { orgId: org.id } } });
  await prisma.budget.deleteMany({ where: { orgId: org.id } });
  await cleanupTestOrg(org.id);
  await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  await prisma.$disconnect();
});

describe('Budgets CRUD', () => {
  let budgetId;

  it('creates a budget with lines', async () => {
    const res = await request(app)
      .post(`/api/orgs/${org.id}/budgets`)
      .set('Authorization', token)
      .send({
        name: 'FY2026 Test Budget', fiscalYear: 2026,
        lines: accountId ? [
          { accountId, period: 1, amount: 5000 },
          { accountId, period: 2, amount: 5500 },
        ] : [],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('FY2026 Test Budget');
    expect(res.body.data.fiscalYear).toBe(2026);
    budgetId = res.body.data.id;
  });

  it('lists budgets for org', async () => {
    const res = await request(app)
      .get(`/api/orgs/${org.id}/budgets`)
      .set('Authorization', token);
    expect(res.status).toBe(200);
    expect(res.body.data.some(b => b.id === budgetId)).toBe(true);
  });

  it('gets a budget with lines', async () => {
    const res = await request(app)
      .get(`/api/orgs/${org.id}/budgets/${budgetId}`)
      .set('Authorization', token);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(budgetId);
    expect(Array.isArray(res.body.data.lines)).toBe(true);
  });

  it('replaces budget lines', async () => {
    if (!accountId) return;
    const res = await request(app)
      .put(`/api/orgs/${org.id}/budgets/${budgetId}/lines`)
      .set('Authorization', token)
      .send({ lines: [
        { accountId, period: 1, amount: 6000 },
        { accountId, period: 2, amount: 6500 },
        { accountId, period: 3, amount: 7000 },
      ]});
    expect(res.status).toBe(200);
    expect(res.body.data.lines).toHaveLength(3);
  });

  it('returns vs-actual comparison', async () => {
    const res = await request(app)
      .get(`/api/orgs/${org.id}/budgets/${budgetId}/vs-actual`)
      .set('Authorization', token);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('rows');
    expect(res.body.data).toHaveProperty('totals');
    expect(res.body.data.totals).toHaveProperty('budget');
    expect(res.body.data.totals).toHaveProperty('actual');
    expect(res.body.data.totals).toHaveProperty('variance');
  });

  it('archives (soft-deletes) a budget', async () => {
    const res = await request(app)
      .delete(`/api/orgs/${org.id}/budgets/${budgetId}`)
      .set('Authorization', token);
    expect(res.status).toBe(204);

    const get = await request(app)
      .get(`/api/orgs/${org.id}/budgets/${budgetId}`)
      .set('Authorization', token);
    expect(get.body.data.status).toBe('archived');
  });

  it('rejects budget creation without accountant role', async () => {
    const viewer = await prisma.user.create({
      data: { fullName:'Viewer', email:`v-${Date.now()}@t.com`, passwordHash:'x', status:'active' },
    });
    await prisma.orgMember.create({ data: { orgId: org.id, userId: viewer.id, role:'viewer' } });
    const res = await request(app)
      .post(`/api/orgs/${org.id}/budgets`)
      .set('Authorization', authHeader(viewer.id).Authorization)
      .send({ name:'Test', fiscalYear: 2026 });
    expect(res.status).toBe(403);
    await prisma.orgMember.deleteMany({ where: { userId: viewer.id } });
    await prisma.user.delete({ where: { id: viewer.id } });
  });
});
