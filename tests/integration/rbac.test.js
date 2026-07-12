import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import {
  createApp, setupTestEnv, cleanupTestOrg,
  createTestUser, createTestMembership,
  createTestContact, authHeader,
} from '../helpers/testApp.js';
import prisma from '../../src/lib/prisma.js';

const app = createApp();
let ownerUser, viewerUser, memberUser, org;

beforeAll(async () => {
  ({ user: ownerUser, org } = await setupTestEnv());

  viewerUser = await createTestUser();
  memberUser = await createTestUser();

  await createTestMembership(viewerUser.id, org.id, 'viewer');
  await createTestMembership(memberUser.id, org.id, 'member');
});

afterAll(async () => {
  await cleanupTestOrg(org.id);
  await prisma.user.deleteMany({
    where: { id: { in: [ownerUser.id, viewerUser.id, memberUser.id] } },
  }).catch(() => {});
  await prisma.$disconnect();
});

describe('Role-based access control', () => {

  it('viewer can list invoices', async () => {
    const res = await request(app)
      .get(`/api/orgs/${org.id}/invoices`)
      .set('Authorization', authHeader(viewerUser.id).Authorization);
    expect(res.status).toBe(200);
  });

  it('viewer cannot create an invoice', async () => {
    const contact = await createTestContact(org.id);
    const res = await request(app)
      .post(`/api/orgs/${org.id}/invoices`)
      .set('Authorization', authHeader(viewerUser.id).Authorization)
      .send({
        contactId: contact.id,
        issueDate: '2026-06-01',
        dueDate:   '2026-07-01',
        lineItems: [{ description: 'Test', quantity: 1, unitPrice: 100, taxRate: 0 }],
      });
    expect(res.status).toBe(403);
  });

  it('member can create an invoice', async () => {
    const contact = await createTestContact(org.id);
    const res = await request(app)
      .post(`/api/orgs/${org.id}/invoices`)
      .set('Authorization', authHeader(memberUser.id).Authorization)
      .send({
        contactId: contact.id,
        issueDate: '2026-06-01',
        dueDate:   '2026-07-01',
        lineItems: [{ description: 'Test', quantity: 1, unitPrice: 100, taxRate: 0 }],
      });
    expect(res.status).toBe(201);
  });

  it('member cannot create chart of accounts entries (requires accountant)', async () => {
    const res = await request(app)
      .post(`/api/orgs/${org.id}/accounts`)
      .set('Authorization', authHeader(memberUser.id).Authorization)
      .send({ code: '9999', name: 'Test Account', type: 'asset', normalBalance: 'debit' });
    expect(res.status).toBe(403);
  });

  it('owner can create chart of accounts entries', async () => {
    const res = await request(app)
      .post(`/api/orgs/${org.id}/accounts`)
      .set('Authorization', authHeader(ownerUser.id).Authorization)
      .send({ code: '9998', name: 'Test Account', type: 'asset', normalBalance: 'debit' });
    expect(res.status).toBe(201);
  });

  it('completely blocks access to another org', async () => {
    const { org: otherOrg } = await setupTestEnv();
    const res = await request(app)
      .get(`/api/orgs/${otherOrg.id}/invoices`)
      .set('Authorization', authHeader(viewerUser.id).Authorization);
    expect(res.status).toBe(403);
    await cleanupTestOrg(otherOrg.id);
  });

  it('unauthenticated requests are rejected with 401', async () => {
    const res = await request(app).get(`/api/orgs/${org.id}/invoices`);
    expect(res.status).toBe(401);
  });
});
