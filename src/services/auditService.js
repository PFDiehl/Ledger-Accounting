// Audit trail service
// Immutable event log for SOC 2 Type II compliance
// Records who did what, when, from where, on which entity

import prisma from '../lib/prisma.js';

// ── Event types ───────────────────────────────────────────────────────────────

export const AUDIT_EVENTS = {
  // Auth
  AUTH_LOGIN:           'auth.login',
  AUTH_LOGOUT:          'auth.logout',
  AUTH_LOGIN_FAILED:    'auth.login_failed',
  AUTH_PASSWORD_CHANGE: 'auth.password_change',
  AUTH_MFA_ENABLED:     'auth.mfa_enabled',

  // Invoices
  INVOICE_CREATED:      'invoice.created',
  INVOICE_SENT:         'invoice.sent',
  INVOICE_PAID:         'invoice.paid',
  INVOICE_VOIDED:       'invoice.voided',
  INVOICE_EDITED:       'invoice.edited',

  // Journal
  JOURNAL_POSTED:       'journal.posted',
  JOURNAL_REVERSED:     'journal.reversed',

  // Payroll
  PAYROLL_CALCULATED:   'payroll.calculated',
  PAYROLL_APPROVED:     'payroll.approved',
  PAYROLL_PROCESSED:    'payroll.processed',

  // Settings
  USER_INVITED:         'user.invited',
  USER_ROLE_CHANGED:    'user.role_changed',
  USER_REMOVED:         'user.removed',

  // Data
  EXPORT_INITIATED:     'export.initiated',
  REPORT_VIEWED:        'report.viewed',

  // Security
  API_KEY_CREATED:      'api_key.created',
  API_KEY_REVOKED:      'api_key.revoked',
  BANK_CONNECTED:       'bank.connected',
  BANK_DISCONNECTED:    'bank.disconnected',
};

// ── Log an audit event ────────────────────────────────────────────────────────

export async function logAuditEvent({
  orgId,
  userId,
  event,
  entityType = null,
  entityId   = null,
  details    = {},
  ipAddress  = null,
  userAgent  = null,
  severity   = 'info',   // info | warning | critical
}) {
  try {
    await prisma.auditLog.create({
      data: {
        orgId,
        userId,
        event,
        entityType,
        entityId,
        details,
        ipAddress,
        userAgent,
        severity,
        occurredAt: new Date(),
      },
    });
  } catch (err) {
    // Audit logging must never crash the application
    console.error('[audit] Failed to log event:', err.message);
  }
}

// ── Express middleware — automatically audit route access ─────────────────────

export function auditMiddleware(event, options = {}) {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = function (body) {
      // Only log on success
      if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
        const entityId = options.entityIdFn ? options.entityIdFn(req, body) : (req.params.id ?? null);
        logAuditEvent({
          orgId:      req.orgId,
          userId:     req.user.id,
          event,
          entityType: options.entityType ?? null,
          entityId,
          details:    options.detailsFn ? options.detailsFn(req, body) : {},
          ipAddress:  req.ip,
          userAgent:  req.headers['user-agent'],
          severity:   options.severity ?? 'info',
        }).catch(() => {});
      }
      return originalJson(body);
    };

    next();
  };
}

// ── Query audit log ───────────────────────────────────────────────────────────

export async function queryAuditLog(orgId, {
  userId,
  event,
  entityType,
  entityId,
  severity,
  from,
  to,
  page   = 1,
  limit  = 50,
} = {}) {
  const where = {
    orgId,
    ...(userId     && { userId }),
    ...(event      && { event: { contains: event } }),
    ...(entityType && { entityType }),
    ...(entityId   && { entityId }),
    ...(severity   && { severity }),
    ...(from || to) && {
      occurredAt: {
        ...(from && { gte: new Date(from) }),
        ...(to   && { lte: new Date(to)   }),
      },
    },
  };

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      skip:    (page - 1) * limit,
      take:    limit,
      include: { user: { select: { fullName: true, email: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { logs, total, page, limit, pages: Math.ceil(total / limit) };
}

// ── SOC 2 compliance report ───────────────────────────────────────────────────

export async function generateSOC2Report(orgId, from, to) {
  const fromDate = new Date(from);
  const toDate   = new Date(to);

  const [
    totalEvents,
    securityEvents,
    failedLogins,
    privilegedActions,
    uniqueUsers,
  ] = await Promise.all([
    prisma.auditLog.count({ where: { orgId, occurredAt: { gte: fromDate, lte: toDate } } }),
    prisma.auditLog.count({ where: { orgId, severity: 'critical', occurredAt: { gte: fromDate, lte: toDate } } }),
    prisma.auditLog.count({ where: { orgId, event: AUDIT_EVENTS.AUTH_LOGIN_FAILED, occurredAt: { gte: fromDate, lte: toDate } } }),
    prisma.auditLog.count({ where: { orgId, event: { in: [AUDIT_EVENTS.JOURNAL_POSTED, AUDIT_EVENTS.PAYROLL_PROCESSED, AUDIT_EVENTS.USER_ROLE_CHANGED] }, occurredAt: { gte: fromDate, lte: toDate } } }),
    prisma.auditLog.groupBy({ by: ['userId'], where: { orgId, occurredAt: { gte: fromDate, lte: toDate } } }).then(r => r.length),
  ]);

  // Top event types
  const eventBreakdown = await prisma.auditLog.groupBy({
    by:    ['event'],
    where: { orgId, occurredAt: { gte: fromDate, lte: toDate } },
    _count:{ id: true },
    orderBy: { _count: { id: 'desc' } },
    take:  20,
  });

  return {
    period:      { from, to },
    summary: {
      totalEvents,
      securityEvents,
      failedLogins,
      privilegedActions,
      uniqueUsers,
    },
    eventBreakdown: eventBreakdown.map(e => ({ event: e.event, count: e._count.id })),
    generatedAt: new Date(),
  };
}
