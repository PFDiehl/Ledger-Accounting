import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { createApp, setupTestEnv, cleanupTestOrg, authHeader } from '../helpers/testApp.js';
import prisma from '../../src/lib/prisma.js';

const app = createApp();
let user, org, token;

beforeAll(async () => {
  ({ user, org } = await setupTestEnv());
  token = authHeader(user.id).Authorization;
});

afterAll(async () => {
  await cleanupTestOrg(org.id);
  await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  await prisma.$disconnect();
});

describe('Contacts CRUD', () => {
  let contactId;

  it('creates a customer contact', async () => {
    const res = await request(app)
      .post(`/api/orgs/${org.id}/contacts`)
      .set('Authorization', token)
      .send({ name: 'Globex Corp', email: 'billing@globex.com', type: 'customer', paymentTerms: 30 });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Globex Corp');
    expect(res.body.data.type).toBe('customer');
    contactId = res.body.data.id;
  });

  it('lists contacts with search', async () => {
    const res = await request(app)
      .get(`/api/orgs/${org.id}/contacts?search=globex`)
      .set('Authorization', token);

    expect(res.status).toBe(200);
    expect(res.body.data.some(c => c.name === 'Globex Corp')).toBe(true);
  });

  it('gets a contact by ID', async () => {
    const res = await request(app)
      .get(`/api/orgs/${org.id}/contacts/${contactId}`)
      .set('Authorization', token);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(contactId);
    expect(res.body.data.email).toBe('billing@globex.com');
  });

  it('updates a contact', async () => {
    const res = await request(app)
      .put(`/api/orgs/${org.id}/contacts/${contactId}`)
      .set('Authorization', token)
      .send({ name: 'Globex Corp', email: 'ap@globex.com', type: 'customer' });

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('ap@globex.com');
  });

  it('returns 404 for non-existent contact', async () => {
    const res = await request(app)
      .get(`/api/orgs/${org.id}/contacts/a0000000-0000-0000-0000-000000000000`)
      .set('Authorization', token);
    expect(res.status).toBe(404);
  });

  it('soft-deletes a contact', async () => {
    const res = await request(app)
      .delete(`/api/orgs/${org.id}/contacts/${contactId}`)
      .set('Authorization', token);
    expect(res.status).toBe(204);

    // Should no longer appear in active list
    const list = await request(app)
      .get(`/api/orgs/${org.id}/contacts`)
      .set('Authorization', token);
    expect(list.body.data.find(c => c.id === contactId)).toBeUndefined();
  });

  it('enforces org isolation — cannot access another org\'s contacts', async () => {
    const otherOrg = await prisma.organization.create({
      data: { name: 'Other Org', slug: `other-${Date.now()}`, email: 'other@org.com' },
    });

    const res = await request(app)
      .get(`/api/orgs/${otherOrg.id}/contacts`)
      .set('Authorization', token);

    expect(res.status).toBe(403);
    await prisma.organization.delete({ where: { id: otherOrg.id } });
  });
});
