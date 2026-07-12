import { describe, it, expect } from '@jest/globals';
import {
  registerSchema, loginSchema, invoiceSchema,
  contactSchema, billSchema, journalEntrySchema,
} from '../../src/lib/schemas.js';

describe('Validation schemas', () => {

  // ── Auth ────────────────────────────────────────────────────────────────────
  describe('registerSchema', () => {
    it('accepts valid registration data', () => {
      const result = registerSchema.safeParse({
        fullName: 'Jane Doe', email: 'jane@example.com',
        password: 'password123', orgName: 'Acme Co.',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid email', () => {
      const result = registerSchema.safeParse({
        fullName: 'Jane', email: 'not-an-email',
        password: 'password123', orgName: 'Acme',
      });
      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toContain('email');
    });

    it('rejects password shorter than 8 chars', () => {
      const result = registerSchema.safeParse({
        fullName: 'Jane', email: 'jane@example.com',
        password: 'short', orgName: 'Acme',
      });
      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toContain('password');
    });
  });

  // ── Invoices ────────────────────────────────────────────────────────────────
  describe('invoiceSchema', () => {
    const validInvoice = {
      contactId: 'a0000000-0000-0000-0000-000000000000',
      issueDate: '2026-06-01',
      dueDate:   '2026-07-01',
      lineItems: [{ description: 'Consulting', quantity: 1, unitPrice: 1000, taxRate: 0 }],
    };

    it('accepts a valid invoice', () => {
      const result = invoiceSchema.safeParse(validInvoice);
      expect(result.success).toBe(true);
    });

    it('rejects invoice with no line items', () => {
      const result = invoiceSchema.safeParse({ ...validInvoice, lineItems: [] });
      expect(result.success).toBe(false);
    });

    it('rejects invalid date format', () => {
      const result = invoiceSchema.safeParse({ ...validInvoice, issueDate: '01/06/2026' });
      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toContain('issueDate');
    });

    it('rejects missing contactId', () => {
      const { contactId, ...rest } = validInvoice;
      const result = invoiceSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('defaults currency to USD', () => {
      const result = invoiceSchema.safeParse(validInvoice);
      expect(result.data.currency).toBe('USD');
    });
  });

  // ── Contacts ────────────────────────────────────────────────────────────────
  describe('contactSchema', () => {
    it('accepts a minimal contact', () => {
      const result = contactSchema.safeParse({ name: 'ACME Corp' });
      expect(result.success).toBe(true);
    });

    it('rejects empty name', () => {
      const result = contactSchema.safeParse({ name: '' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid website URL', () => {
      const result = contactSchema.safeParse({ name: 'ACME', website: 'not-a-url' });
      expect(result.success).toBe(false);
    });

    it('accepts empty string for optional email', () => {
      const result = contactSchema.safeParse({ name: 'ACME', email: '' });
      expect(result.success).toBe(true);
    });
  });

  // ── Journal entries ─────────────────────────────────────────────────────────
  describe('journalEntrySchema', () => {
    const validEntry = {
      date:        '2026-06-01',
      description: 'Test entry',
      lines: [
        { accountId: 'a0000000-0000-0000-0000-000000000001', debit: 1000, credit: 0 },
        { accountId: 'a0000000-0000-0000-0000-000000000002', debit: 0,    credit: 1000 },
      ],
    };

    it('accepts a valid balanced entry', () => {
      const result = journalEntrySchema.safeParse(validEntry);
      expect(result.success).toBe(true);
    });

    it('rejects entries with fewer than 2 lines', () => {
      const result = journalEntrySchema.safeParse({ ...validEntry, lines: [validEntry.lines[0]] });
      expect(result.success).toBe(false);
    });

    it('rejects invalid account UUID', () => {
      const result = journalEntrySchema.safeParse({
        ...validEntry,
        lines: [
          { accountId: 'not-a-uuid', debit: 100, credit: 0 },
          { accountId: 'a0000000-0000-0000-0000-000000000002', debit: 0, credit: 100 },
        ],
      });
      expect(result.success).toBe(false);
    });
  });
});
