import { z } from 'zod';

// ── Auth ──────────────────────────────────────

export const registerSchema = z.object({
  fullName: z.string().min(2).max(100),
  email:    z.string().email(),
  password: z.string().min(8).max(100),
  orgName:  z.string().min(2).max(100),
});

export const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

// ── Contacts ──────────────────────────────────

export const contactSchema = z.object({
  type:         z.enum(['customer', 'vendor', 'both']).default('customer'),
  name:         z.string().min(1).max(200),
  email:        z.string().email().optional().or(z.literal('')),
  phone:        z.string().optional(),
  website:      z.string().url().optional().or(z.literal('')),
  taxId:        z.string().optional(),
  addressLine1: z.string().optional(),
  city:         z.string().optional(),
  state:        z.string().optional(),
  postalCode:   z.string().optional(),
  country:      z.string().length(2).default('US'),
  currency:     z.string().length(3).default('USD'),
  paymentTerms: z.number().int().min(0).max(365).default(30),
  notes:        z.string().optional(),
});

// ── Invoices ──────────────────────────────────

const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity:    z.number().positive(),
  unitPrice:   z.number().min(0),
  taxRate:     z.number().min(0).max(100).default(0),
  accountId:   z.string().uuid().optional(),
  sortOrder:   z.number().int().default(0),
});

export const invoiceSchema = z.object({
  contactId:  z.string().uuid(),
  issueDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency:   z.string().length(3).default('USD'),
  notes:      z.string().optional(),
  footer:     z.string().optional(),
  lineItems:  z.array(lineItemSchema).min(1),
});

export const invoiceStatusSchema = z.object({
  status: z.enum(['draft', 'sent', 'paid', 'void']),
  voidReason: z.string().optional(),
});

// ── Bills ─────────────────────────────────────

export const billSchema = z.object({
  contactId:  z.string().uuid(),
  billNumber: z.string().optional(),
  billDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency:   z.string().length(3).default('USD'),
  notes:      z.string().optional(),
  lineItems:  z.array(lineItemSchema).min(1),
});

// ── Payments ──────────────────────────────────

export const paymentSchema = z.object({
  type:          z.enum(['incoming', 'outgoing']),
  contactId:     z.string().uuid().optional(),
  amount:        z.number().positive(),
  currency:      z.string().length(3).default('USD'),
  paymentDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method:        z.enum(['bank_transfer','check','credit_card','cash','stripe','paypal','other']),
  reference:     z.string().optional(),
  bankAccountId: z.string().uuid().optional(),
  notes:         z.string().optional(),
  allocations: z.array(z.object({
    invoiceId: z.string().uuid().optional(),
    billId:    z.string().uuid().optional(),
    amount:    z.number().positive(),
  })).optional(),
});

// ── Journal entries ───────────────────────────

export const journalEntrySchema = z.object({
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1),
  lines: z.array(z.object({
    accountId:   z.string().uuid(),
    description: z.string().optional(),
    debit:       z.number().min(0).default(0),
    credit:      z.number().min(0).default(0),
  })).min(2),
});

// ── Accounts ──────────────────────────────────

export const accountSchema = z.object({
  parentId:     z.string().uuid().optional(),
  code:         z.string().min(1).max(20),
  name:         z.string().min(1).max(200),
  type:         z.enum(['asset','liability','equity','revenue','expense']),
  description:  z.string().optional(),
  normalBalance: z.enum(['debit','credit']),
});

// ── Pagination / filtering ────────────────────

export const paginationSchema = z.object({
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortDir: z.enum(['asc','desc']).default('desc'),
});
