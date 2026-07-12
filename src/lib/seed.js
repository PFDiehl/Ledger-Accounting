// Demo seeder — creates a realistic demo org with 6 months of transactions
// Run: node src/lib/seed.js --demo
// Safe to re-run: deletes and recreates the demo org each time

import 'dotenv/config';
import prisma from './prisma.js';
import bcrypt from 'bcryptjs';

const DEMO_EMAIL    = process.env.DEMO_EMAIL    ?? 'demo@ledger.app';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demo123';
const DEMO_ORG_SLUG = 'demo-acme-co';

async function seed() {
  console.log('[seed] Starting demo seed…');

  // ── Clean up existing demo org ────────────────────────────────────────────
  const existingOrg = await prisma.organization.findFirst({ where: { slug: DEMO_ORG_SLUG } });
  if (existingOrg) {
    console.log('[seed] Cleaning existing demo org…');
    // Cascade deletes handle related data
    await prisma.organization.delete({ where: { id: existingOrg.id } });
  }

  // ── Create demo user ──────────────────────────────────────────────────────
  let user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        fullName:     'Alex Demo',
        email:        DEMO_EMAIL,
        passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
        status:       'active',
      },
    });
    console.log(`[seed] Created demo user: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  }

  // ── Create demo org ───────────────────────────────────────────────────────
  const org = await prisma.organization.create({
    data: {
      name:         'Acme Co.',
      slug:         DEMO_ORG_SLUG,
      email:        'billing@acmeco.com',
      currency:     'USD',
      plan:         'professional',
      planStatus:   'active',
      members: { create: { userId: user.id, role: 'owner' } },
    },
  });
  console.log(`[seed] Created org: ${org.name} (${org.id})`);

  // ── Sequences ─────────────────────────────────────────────────────────────
  await prisma.sequence.createMany({
    data: [
      { orgId: org.id, name: 'invoice', prefix: 'INV-', nextVal: 1042 },
      { orgId: org.id, name: 'bill',    prefix: 'BILL-', nextVal: 1012 },
      { orgId: org.id, name: 'journal', prefix: 'JE-',   nextVal: 200  },
    ],
  });

  // ── Chart of Accounts ─────────────────────────────────────────────────────
  const accounts = await prisma.account.createManyAndReturn({
    data: [
      { orgId: org.id, code:'1010', name:'Checking Account',      type:'asset',    subtype:'bank',               normalBalance:'debit',  isSystem:true  },
      { orgId: org.id, code:'1020', name:'Savings Account',       type:'asset',    subtype:'bank',               normalBalance:'debit',  isSystem:false },
      { orgId: org.id, code:'1100', name:'Accounts Receivable',   type:'asset',    subtype:'accounts_receivable',normalBalance:'debit',  isSystem:true  },
      { orgId: org.id, code:'2100', name:'Accounts Payable',      type:'liability',subtype:'accounts_payable',   normalBalance:'credit', isSystem:true  },
      { orgId: org.id, code:'4010', name:'Sales Revenue',         type:'revenue',  subtype:'operating_revenue',  normalBalance:'credit', isSystem:true  },
      { orgId: org.id, code:'4020', name:'Service Revenue',       type:'revenue',  subtype:'operating_revenue',  normalBalance:'credit', isSystem:false },
      { orgId: org.id, code:'6010', name:'Salaries & Wages',      type:'expense',  subtype:'payroll_expense',    normalBalance:'debit',  isSystem:false },
      { orgId: org.id, code:'6030', name:'Rent',                  type:'expense',  subtype:'other_expense',      normalBalance:'debit',  isSystem:false },
      { orgId: org.id, code:'6060', name:'Software Subscriptions',type:'expense',  subtype:'other_expense',      normalBalance:'debit',  isSystem:false },
      { orgId: org.id, code:'6080', name:'Travel & Entertainment',type:'expense',  subtype:'other_expense',      normalBalance:'debit',  isSystem:false },
      { orgId: org.id, code:'6090', name:'Marketing',             type:'expense',  subtype:'other_expense',      normalBalance:'debit',  isSystem:false },
      { orgId: org.id, code:'2401', name:'Payroll Tax Payable',   type:'liability',subtype:'tax_payable',        normalBalance:'credit', isSystem:false },
    ],
  });
  const acct = (code) => accounts.find(a => a.code === code);

  // ── Contacts ──────────────────────────────────────────────────────────────
  const contacts = await prisma.contact.createManyAndReturn({
    data: [
      { orgId:org.id, type:'customer', name:'Globex Corp',        email:'billing@globex.com',   paymentTerms:30 },
      { orgId:org.id, type:'customer', name:'Initech',            email:'ap@initech.com',        paymentTerms:15 },
      { orgId:org.id, type:'customer', name:'Umbrella Ltd',       email:'finance@umbrella.com',  paymentTerms:30 },
      { orgId:org.id, type:'customer', name:'Wayne Enterprises',  email:'accounts@wayne.com',    paymentTerms:30 },
      { orgId:org.id, type:'vendor',   name:'Amazon Web Services',email:'aws@amazon.com',        paymentTerms:30 },
      { orgId:org.id, type:'vendor',   name:'WeWork',             email:'billing@wework.com',    paymentTerms:1  },
      { orgId:org.id, type:'vendor',   name:'Shopify',            email:'billing@shopify.com',   paymentTerms:30 },
      { orgId:org.id, type:'vendor',   name:'Gusto',              email:'support@gusto.com',     paymentTerms:1  },
    ],
  });
  const c = (name) => contacts.find(x => x.name === name);

  // ── Bank account ──────────────────────────────────────────────────────────
  const bankAccount = await prisma.bankAccount.create({
    data: {
      orgId:           org.id,
      ledgerAccountId: acct('1010').id,
      name:            'Chase Business Checking',
      institutionName: 'JPMorgan Chase',
      accountType:     'depository',
      mask:            '4821',
      currency:        'USD',
      currentBalance:  33440,
      availableBalance:33440,
      connectionType:  'manual',
    },
  });

  // ── Journal entries (6 months of P&L) ────────────────────────────────────
  const je = async (date, description, lines) => {
    const seq = await prisma.sequence.update({
      where:  { orgId_name: { orgId: org.id, name: 'journal' } },
      data:   { nextVal: { increment: 1 } },
      select: { prefix: true, nextVal: true },
    });
    await prisma.journalEntry.create({
      data: {
        orgId: org.id, status: 'posted', source: 'manual',
        entryNumber: `${seq.prefix}${String(seq.nextVal - 1).padStart(4,'0')}`,
        date: new Date(date), description,
        createdById: user.id, postedAt: new Date(date),
        lines: { createMany: { data: lines } },
      },
    });
  };

  // Monthly revenue + expenses for last 6 months
  for (let m = 5; m >= 0; m--) {
    const d     = new Date(); d.setDate(1); d.setMonth(d.getMonth() - m);
    const month = d.toISOString().slice(0,7);
    const rev   = 38000 + Math.round(Math.random() * 14000);
    const sal   = 26000;
    const rent  = 2400;
    const sw    = 1500 + Math.round(Math.random() * 500);

    await je(`${month}-15`, `Revenue — ${month}`, [
      { accountId: acct('1010').id, debit: rev, credit: 0     },
      { accountId: acct('4010').id, debit: 0,   credit: rev   },
    ]);
    await je(`${month}-28`, `Payroll — ${month}`, [
      { accountId: acct('6010').id, debit: sal, credit: 0     },
      { accountId: acct('1010').id, debit: 0,   credit: sal   },
    ]);
    await je(`${month}-01`, `Rent — ${month}`, [
      { accountId: acct('6030').id, debit: rent, credit: 0    },
      { accountId: acct('1010').id, debit: 0,    credit: rent },
    ]);
    await je(`${month}-05`, `Software subscriptions — ${month}`, [
      { accountId: acct('6060').id, debit: sw,  credit: 0     },
      { accountId: acct('1010').id, debit: 0,   credit: sw    },
    ]);
  }

  // ── Invoices ──────────────────────────────────────────────────────────────
  const invoiceData = [
    { contact: 'Globex Corp',       amount: 4200,  status: 'sent',    daysAgo:3,  dueDays:27 },
    { contact: 'Initech',           amount: 7500,  status: 'paid',    daysAgo:15, dueDays:0  },
    { contact: 'Umbrella Ltd',      amount: 3100,  status: 'overdue', daysAgo:60, dueDays:-30},
    { contact: 'Wayne Enterprises', amount: 3580,  status: 'overdue', daysAgo:25, dueDays:-10},
    { contact: 'Globex Corp',       amount: 4200,  status: 'draft',   daysAgo:1,  dueDays:29 },
    { contact: 'Initech',           amount: 4500,  status: 'paid',    daysAgo:45, dueDays:0  },
  ];

  for (const [i, inv] of invoiceData.entries()) {
    const contact  = c(inv.contact);
    const issueDate = new Date(Date.now() - inv.daysAgo * 864e5);
    const dueDate   = new Date(issueDate.getTime() + 30 * 864e5);

    await prisma.invoice.create({
      data: {
        orgId: org.id,
        contactId: contact.id,
        invoiceNumber: `INV-10${40 + i}`,
        status:    inv.status,
        issueDate,
        dueDate,
        currency:  'USD',
        subtotal:  inv.amount,
        taxAmount: 0,
        total:     inv.amount,
        amountPaid:inv.status === 'paid' ? inv.amount : inv.status === 'partial' ? inv.amount / 2 : 0,
        createdById: user.id,
        lineItems: {
          create: [{
            description: `Professional services — ${inv.contact}`,
            quantity:    1,
            unitPrice:   inv.amount,
            amount:      inv.amount,
            sortOrder:   0,
          }],
        },
      },
    });
  }

  // ── Bank transactions ─────────────────────────────────────────────────────
  const txns = [
    { date:3,  desc:'ACH GLOBEX CORP',          amount:4200,    category:'Sales',     status:'categorized' },
    { date:5,  desc:'GOOGLE *WORKSPACE',        amount:-144,    category:'Software',  status:'categorized' },
    { date:7,  desc:'SHOPIFY* MONTHLY',         amount:-299,    category:'Software',  status:'categorized' },
    { date:10, desc:'WEWORK MONTHLY RENT',      amount:-2400,   category:'Rent',      status:'categorized' },
    { date:12, desc:'AMAZON WEB SERVICES',      amount:-892,    category:'Software',  status:'unreviewed'  },
    { date:14, desc:'ACH INITECH PAYMENT',      amount:7500,    category:'Sales',     status:'categorized' },
    { date:15, desc:'STRIPE FEES',              amount:-418,    category:'Fees',      status:'unreviewed'  },
    { date:18, desc:'UBER *TRIP',               amount:-24.50,  category:'Travel',    status:'unreviewed'  },
    { date:20, desc:'DELTA AIR LINES',          amount:-312,    category:'Travel',    status:'unreviewed'  },
    { date:22, desc:'MARRIOTT HOTELS',          amount:-429,    category:'Travel',    status:'unreviewed'  },
  ];

  for (const t of txns) {
    const date = new Date(Date.now() - t.date * 864e5);
    await prisma.bankTransaction.create({
      data: {
        orgId:         org.id,
        bankAccountId: bankAccount.id,
        date,
        description:   t.desc,
        amount:        t.amount,
        currency:      'USD',
        category:      t.category,
        status:        t.status,
        merchantName:  t.desc.split(' ')[0],
        accountId:     t.status === 'categorized' ? acct(t.category === 'Sales' ? '4010' : '6060').id : null,
      },
    });
  }

  console.log('[seed] ✓ Demo data seeded successfully');
  console.log(`[seed] Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`[seed] Org: ${org.name} (${org.id})`);
}

seed()
  .catch(err => { console.error('[seed] Error:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
