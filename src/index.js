import 'dotenv/config';
import express      from 'express';
import cors         from 'cors';
import helmet       from 'helmet';
import morgan       from 'morgan';
import rateLimit    from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import compression  from 'compression';

import { errorHandler } from './middleware/errorHandler.js';
import { securityHeaders, requestId, responseTime, orgRateLimit, queryGuard } from './middleware/performance.js';

import authRoutes          from './routes/auth.js';
import contactRoutes       from './routes/contacts.js';
import invoiceRoutes       from './routes/invoices.js';
import billRoutes          from './routes/bills.js';
import accountRoutes       from './routes/accounts.js';
import reportRoutes        from './routes/reports.js';
import payrollRoutes       from './routes/payroll.js';
import advancedPayrollRoutes from './routes/advancedPayroll.js';
import bankingRoutes       from './routes/banking.js';
import plaidRoutes         from './routes/plaid.js';
import expenseRoutes       from './routes/expenses.js';
import portalRoutes        from './routes/portal.js';
import budgetRoutes        from './routes/budgets.js';
import currencyRoutes      from './routes/currencies.js';
import recurringRoutes     from './routes/recurring.js';
import documentRoutes      from './routes/documents.js';
import forexRoutes         from './routes/forex.js';
import schedulerRoutes     from './routes/scheduler.js';
import billingRoutes       from './routes/billing.js';
import aiRoutes            from './routes/ai.js';
import ecommerceRoutes     from './routes/ecommerce.js';
import auditRoutes         from './routes/audit.js';
import digestRoutes        from './routes/digest.js';
import tenantRoutes        from './routes/tenants.js';

const app  = express();
const PORT = process.env.PORT ?? 3001;

app.set('trust proxy', 1);
app.use(requestId);
app.use(responseTime);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(securityHeaders);
app.use(cors({ origin: true, credentials: true }));
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(cookieParser());

app.use('/api/portal/stripe/webhook', express.raw({ type: '*/*' }));
app.use('/api/billing/webhook',        express.raw({ type: '*/*' }));
app.use(express.json({ limit: '10mb' }));

app.use('/api/auth',    rateLimit({ windowMs:15*60*1000, max:20, standardHeaders:true }));
app.use('/api',         rateLimit({ windowMs:60*1000,    max:500, standardHeaders:true }));

app.get('/health', (req, res) => res.json({ status:'ok', ts:new Date(), env:process.env.NODE_ENV }));

app.use('/api/portal',  portalRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/auth',    authRoutes);
app.use('/api/tenants', tenantRoutes);

const org = express.Router({ mergeParams: true });
org.use(orgRateLimit({ max:300 }));
org.use(queryGuard);

org.use('/contacts',        contactRoutes);
org.use('/invoices',        invoiceRoutes);
org.use('/bills',           billRoutes);
org.use('/expenses',        expenseRoutes);
org.use('/accounts',        accountRoutes);
org.use('/reports',         reportRoutes);
org.use('/payroll',         payrollRoutes);
org.use('/payroll',         advancedPayrollRoutes);
org.use('/banking',         bankingRoutes);
org.use('/plaid',           plaidRoutes);
org.use('/budgets',         budgetRoutes);
org.use('/currencies',      currencyRoutes);
org.use('/recurring',       recurringRoutes);
org.use('/documents',       documentRoutes);
org.use('/forex',           forexRoutes);
org.use('/scheduler',       schedulerRoutes);
org.use('/ai',              aiRoutes);
org.use('/ecommerce',       ecommerceRoutes);
org.use('/audit',           auditRoutes);
org.use('/digest',          digestRoutes);

app.use('/api/orgs/:orgId', org);

app.use((req, res) => res.status(404).json({ success:false, message:`Cannot ${req.method} ${req.path}` }));
app.use(errorHandler);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Ledger API on :${PORT} [${process.env.NODE_ENV ?? 'development'}]`);
});

export default app;

