import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { createApp, createTestUser, cleanupTestOrg } from '../helpers/testApp.js';
import prisma from '../../src/lib/prisma.js';

const app = createApp();
let createdOrgId = null;

afterAll(async () => {
  if (createdOrgId) await cleanupTestOrg(createdOrgId).catch(() => {});
  await prisma.$disconnect();
});

describe('POST /api/auth/register', () => {
  it('creates a user and org, returns access token', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        fullName: 'Test Owner',
        email:    `owner-${Date.now()}@test.com`,
        password: 'password123',
        orgName:  'Test Co.',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user.email).toMatch(/@test\.com/);
    expect(res.body.data.org.name).toBe('Test Co.');

    createdOrgId = res.body.data.org.id;
  });

  it('rejects duplicate email', async () => {
    const email = `dup-${Date.now()}@test.com`;
    await request(app).post('/api/auth/register').send({
      fullName: 'User', email, password: 'password123', orgName: 'Org',
    });
    const res = await request(app).post('/api/auth/register').send({
      fullName: 'User2', email, password: 'password123', orgName: 'Org2',
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
  });

  it('rejects short password', async () => {
    const res = await request(app).post('/api/auth/register').send({
      fullName: 'User', email: 'short@test.com', password: 'short', orgName: 'Org',
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/auth/login', () => {
  it('returns token for valid credentials', async () => {
    const email = `login-${Date.now()}@test.com`;
    await request(app).post('/api/auth/register').send({
      fullName: 'Login User', email, password: 'password123', orgName: 'Login Org',
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user.email).toBe(email);
    expect(res.body.data.orgs).toHaveLength(1);
    expect(res.body.data.orgs[0].role).toBe('owner');
  });

  it('rejects wrong password', async () => {
    const email = `wrongpw-${Date.now()}@test.com`;
    await request(app).post('/api/auth/register').send({
      fullName: 'User', email, password: 'correctpassword', orgName: 'Org',
    });
    const res = await request(app).post('/api/auth/login').send({ email, password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  it('rejects non-existent user', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'nobody@nowhere.com', password: 'password123',
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('returns user info with valid token', async () => {
    const email = `me-${Date.now()}@test.com`;
    const reg = await request(app).post('/api/auth/register').send({
      fullName: 'Me User', email, password: 'password123', orgName: 'Me Org',
    });
    const token = reg.body.data.accessToken;

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(email);
  });

  it('rejects request with no token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects request with malformed token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});
