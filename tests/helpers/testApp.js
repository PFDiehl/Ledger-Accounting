import 'dotenv/config';
import express         from 'express';
import cors            from 'cors';
import cookieParser    from 'cookie-parser';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import authRoutes      from '../../src/routes/auth.js';
import contactRoutes   from '../../src/routes/contacts.js';
import invoiceRoutes   from '../../src/routes/invoices.js';
import billRoutes      from '../../src/routes/bills.js';
import accountRoutes   from '../../src/routes/accounts.js';
import reportRoutes    from '../../src/routes/reports.js';
import payrollRoutes   from '../../src/routes/payroll.js';
import prisma          from '../../src/lib/prisma.js';
import bcrypt          from 'bcryptjs';
import { signAccessToken } from '../../src/lib/tokens.js';

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(cors({ credentials: true }));

  app.use('/api/auth',                 authRoutes);
  app.use('/api/orgs/:orgId/contacts', contactRoutes);
  app.use('/api/orgs/:orgId/invoices', invoiceRoutes);
  app.use('/api/orgs/:orgId/bills',    billRoutes);
  app.use('/api/orgs/:orgId/accounts', accountRoutes);
  app.use('/api/orgs/:orgId/reports',  reportRoutes);
  app.use('/api/orgs/:orgId/payroll',  payrollRoutes);
  app.use(errorHandler);

  return app;
}

// ── Test data factories ───────────────────────────────────────────────────────

export async function createTestOrg(overrides = {}) {
  return prisma.organization.create({
    data: {
      name:     'Test Co.',
      slug:     `test-${Date.now()}`,
      email:    'test@testco.com',
      currency: 'USD',
      ...overrides,
    },
  });
}

export async function createTestUser(overrides = {}) {
  const passwordHash = await bcrypt.hash('password123', 10);
  return prisma.user.create({
    data: {
      fullName:     'Test User',
      email:        `test-${Date.now()}@example.com`,
      passwordHash,
      status:       'active',
      ...overrides,
    },
  });
}

export async function createTestMembership(userId, orgId, role = 'owner') {
  return prisma.orgMember.create({ data: { userId, orgId, role } });
}

export async function createTestContact(orgId, overrides = {}) {
  return prisma.contact.create({
    data: {
      orgId,
      type:  'customer',
      name:  'ACME Client',
      email: 'client@acme.com',
      ...overrides,
    },
  });
}

export async function seedSequences(orgId) {
  return prisma.sequence.createMany({
    data: [
      { orgId, name: 'invoice', prefix: 'INV-', nextVal: 1001 },
      { orgId, name: 'bill',    prefix: 'BILL-', nextVal: 1001 },
      { orgId, name: 'journal', prefix: 'JE-',   nextVal: 1 },
    ],
    skipDuplicates: true,
  });
}

export async function seedAccounts(orgId) {
  return prisma.account.createMany({
    skipDuplicates: true,
    data: [
      { orgId, code: '1010', name: 'Checking',           type: 'asset',   subtype: 'bank',               normalBalance: 'debit',  isSystem: true  },
      { orgId, code: '1100', name: 'Accounts Receivable',type: 'asset',   subtype: 'accounts_receivable', normalBalance: 'debit',  isSystem: true  },
      { orgId, code: '2100', name: 'Accounts Payable',   type: 'liability',subtype:'accounts_payable',   normalBalance: 'credit', isSystem: true  },
      { orgId, code: '4010', name: 'Sales',              type: 'revenue', subtype: 'operating_revenue',  normalBalance: 'credit', isSystem: true  },
      { orgId, code: '6010', name: 'Salaries',           type: 'expense', subtype: 'payroll_expense',    normalBalance: 'debit',  isSystem: false },
      { orgId, code: '2400', name: 'Payroll Tax Payable',type: 'liability',subtype:'tax_payable',        normalBalance: 'credit', isSystem: false },
    ],
  });
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

export function authHeader(userId) {
  return { Authorization: `Bearer ${signAccessToken({ userId })}` };
}

export async function setupTestEnv() {
  const user = await createTestUser();
  const org  = await createTestOrg();
  await createTestMembership(user.id, org.id, 'owner');
  await seedSequences(org.id);
  await seedAccounts(org.id);
  return { user, org };
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

export async function cleanupTestOrg(orgId) {
  // Delete in dependency order
  await prisma.payStub.deleteMany({ where: { payRun: { orgId } } });
  await prisma.payRun.deleteMany({ where: { orgId } });
  await prisma.employee.deleteMany({ where: { orgId } });
  await prisma.reconciliationItem.deleteMany({ where: { reconciliation: { orgId } } });
  await prisma.reconciliation.deleteMany({ where: { orgId } });
  await prisma.bankTransaction.deleteMany({ where: { orgId } });
  await prisma.bankAccount.deleteMany({ where: { orgId } });
  await prisma.paymentAllocation.deleteMany({ where: { payment: { orgId } } });
  await prisma.payment.deleteMany({ where: { orgId } });
  await prisma.invoiceLineItem.deleteMany({ where: { invoice: { orgId } } });
  await prisma.invoice.deleteMany({ where: { orgId } });
  await prisma.billLineItem.deleteMany({ where: { bill: { orgId } } });
  await prisma.bill.deleteMany({ where: { orgId } });
  await prisma.journalLine.deleteMany({ where: { entry: { orgId } } });
  await prisma.journalEntry.deleteMany({ where: { orgId } });
  await prisma.account.deleteMany({ where: { orgId } });
  await prisma.contact.deleteMany({ where: { orgId } });
  await prisma.sequence.deleteMany({ where: { orgId } });
  await prisma.orgMember.deleteMany({ where: { orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
}
