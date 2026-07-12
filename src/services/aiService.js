// AI service — wraps the Anthropic API for all Ledger AI features
// Uses claude-sonnet-4-20250514 for all tasks

const MODEL   = 'claude-sonnet-4-20250514';
const API_URL = 'https://api.anthropic.com/v1/messages';

async function callClaude({ system, messages, maxTokens = 1024, tools = null }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const body = {
    model:      MODEL,
    max_tokens: maxTokens,
    system,
    messages,
    ...(tools && { tools }),
  };

  const res  = await fetch(API_URL, {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Anthropic API error ${res.status}: ${err.error?.message ?? 'unknown'}`);
  }

  return res.json();
}

// Extract text from response
function getText(response) {
  return response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
}

// Parse JSON from response (strips markdown fences)
function parseJSON(response) {
  const text = getText(response).trim();
  const clean = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(clean);
}

// ── 1. Smart transaction categorization ──────────────────────────────────────

export async function categorizeTransactions(transactions, chartOfAccounts) {
  const accountList = chartOfAccounts
    .map(a => `${a.code} — ${a.name} (${a.type})`)
    .join('\n');

  const response = await callClaude({
    system: `You are an expert bookkeeper. Categorize bank transactions to the correct accounts from the chart of accounts.
Return ONLY a JSON array, no markdown, no explanation.
Each item: { "id": string, "accountCode": string, "accountName": string, "confidence": number (0-1), "reasoning": string }`,
    messages: [{
      role: 'user',
      content: `Chart of accounts:\n${accountList}\n\nTransactions to categorize:\n${JSON.stringify(transactions.map(t => ({
        id:          t.id,
        date:        t.date,
        description: t.description,
        amount:      t.amount,
        merchant:    t.merchantName,
      })), null, 2)}`
    }],
    maxTokens: 2048,
  });

  const results = parseJSON(response);

  // Merge back with original transactions
  const map = {};
  results.forEach(r => { map[r.id] = r; });

  return transactions.map(t => ({
    ...t,
    aiCategory:     map[t.id]?.accountName  ?? null,
    aiAccountCode:  map[t.id]?.accountCode  ?? null,
    aiConfidence:   map[t.id]?.confidence   ?? 0,
    aiReasoning:    map[t.id]?.reasoning    ?? null,
  }));
}

// ── 2. Anomaly detection ──────────────────────────────────────────────────────

export async function detectAnomalies(transactions, historicalContext) {
  const response = await callClaude({
    system: `You are a financial analyst specializing in fraud detection and anomaly identification.
Analyze transactions and identify anything unusual, suspicious, or worth reviewing.
Return ONLY a JSON object, no markdown:
{
  "anomalies": [{ "transactionId": string, "type": string, "severity": "low"|"medium"|"high", "description": string, "recommendation": string }],
  "summary": string,
  "riskScore": number (0-100)
}`,
    messages: [{
      role: 'user',
      content: `Historical context (last 90 days averages by category):
${JSON.stringify(historicalContext, null, 2)}

Recent transactions to analyze:
${JSON.stringify(transactions.map(t => ({
  id:          t.id,
  date:        t.date,
  description: t.description,
  amount:      t.amount,
  category:    t.category,
  merchant:    t.merchantName,
})), null, 2)}`
    }],
    maxTokens: 2048,
  });

  return parseJSON(response);
}

// ── 3. Cash flow forecasting ──────────────────────────────────────────────────

export async function forecastCashFlow(data) {
  const { historicalMonths, recurringItems, openInvoices, openBills, bankBalance } = data;

  const response = await callClaude({
    system: `You are a CFO-level financial analyst. Forecast 12-week cash flow.
Return ONLY a JSON object, no markdown:
{
  "weeks": [{ "weekStarting": "YYYY-MM-DD", "openingBalance": number, "expectedInflows": number, "expectedOutflows": number, "closingBalance": number, "confidence": "high"|"medium"|"low", "notes": string }],
  "insights": [string],
  "warnings": [{ "week": string, "message": string, "severity": "info"|"warning"|"critical" }],
  "summary": string
}`,
    messages: [{
      role: 'user',
      content: `Current bank balance: $${bankBalance}

Historical monthly P&L (last 6 months):
${JSON.stringify(historicalMonths, null, 2)}

Recurring commitments:
${JSON.stringify(recurringItems, null, 2)}

Open invoices (expected inflows):
${JSON.stringify(openInvoices.map(i => ({
  amount: i.amountDue, dueDate: i.dueDate, client: i.contact?.name, daysOverdue: i.daysOverdue ?? 0,
})), null, 2)}

Open bills (expected outflows):
${JSON.stringify(openBills.map(b => ({
  amount: b.amountDue, dueDate: b.dueDate, vendor: b.contact?.name,
})), null, 2)}`
    }],
    maxTokens: 3000,
  });

  return parseJSON(response);
}

// ── 4. Receipt / document parsing ────────────────────────────────────────────

export async function parseReceiptWithAI(ocrText, existingExpenseData = {}) {
  const response = await callClaude({
    system: `You are an expense management specialist. Extract structured data from receipt OCR text.
Return ONLY a JSON object, no markdown:
{
  "vendor": string,
  "date": "YYYY-MM-DD",
  "total": number,
  "subtotal": number,
  "taxAmount": number,
  "tipAmount": number,
  "currency": "USD",
  "category": string,
  "lineItems": [{ "description": string, "quantity": number, "unitPrice": number, "total": number }],
  "paymentMethod": string,
  "receiptNumber": string,
  "notes": string,
  "confidence": number
}`,
    messages: [{
      role: 'user',
      content: `OCR text from receipt:\n${ocrText}\n\nExisting data (if any): ${JSON.stringify(existingExpenseData)}`
    }],
    maxTokens: 1024,
  });

  return parseJSON(response);
}

// ── 5. Natural language invoice drafting ─────────────────────────────────────

export async function draftInvoiceFromText(naturalLanguage, contacts, accounts) {
  const contactList = contacts.slice(0, 20).map(c => `${c.id}: ${c.name}`).join('\n');

  const response = await callClaude({
    system: `You are an invoicing assistant. Convert natural language descriptions into structured invoice data.
Return ONLY a JSON object, no markdown:
{
  "contactId": string | null,
  "contactName": string,
  "issueDate": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD",
  "currency": "USD",
  "lineItems": [{ "description": string, "quantity": number, "unitPrice": number, "taxRate": number }],
  "notes": string,
  "confidence": number,
  "assumptions": [string]
}`,
    messages: [{
      role: 'user',
      content: `Today is ${new Date().toISOString().slice(0,10)}.

Known clients:\n${contactList}

User request: "${naturalLanguage}"`
    }],
    maxTokens: 1024,
  });

  return parseJSON(response);
}

// ── 6. Financial insights assistant ──────────────────────────────────────────

export async function getFinancialInsights(question, financialContext) {
  const response = await callClaude({
    system: `You are a knowledgeable CFO and financial advisor for small businesses.
Answer questions about the business's finances clearly and practically.
Be specific, cite the actual numbers from the context, and give actionable advice.
Keep responses concise — 2-4 paragraphs maximum.
Do not make up numbers not present in the context.`,
    messages: [{
      role: 'user',
      content: `Financial context for ${financialContext.orgName}:

Period: ${financialContext.period}
Revenue: $${financialContext.revenue?.toLocaleString()}
Expenses: $${financialContext.expenses?.toLocaleString()}
Net profit: $${financialContext.netProfit?.toLocaleString()}
Profit margin: ${financialContext.profitMargin?.toFixed(1)}%
Cash on hand: $${financialContext.cashBalance?.toLocaleString()}
Outstanding AR: $${financialContext.outstandingAR?.toLocaleString()}
Outstanding AP: $${financialContext.outstandingAP?.toLocaleString()}
Overdue invoices: ${financialContext.overdueCount} totalling $${financialContext.overdueAmount?.toLocaleString()}

Top expense categories: ${JSON.stringify(financialContext.topExpenses)}
Revenue trend (6 months): ${JSON.stringify(financialContext.revenueTrend)}

Question: ${question}`
    }],
    maxTokens: 1024,
  });

  return getText(response);
}

// ── 7. Batch categorization with learning ────────────────────────────────────
// Learns from previously categorized transactions to improve suggestions

export async function learnAndCategorize(newTransactions, learnedRules) {
  const response = await callClaude({
    system: `You are an expert bookkeeper with access to learned categorization rules.
Apply the learned rules first, then use your expertise for uncovered cases.
Return ONLY a JSON array, no markdown.
Each item: { "id": string, "accountCode": string, "accountName": string, "confidence": number, "source": "learned"|"inferred" }`,
    messages: [{
      role: 'user',
      content: `Learned rules (merchant → account mappings):
${JSON.stringify(learnedRules, null, 2)}

New transactions to categorize:
${JSON.stringify(newTransactions.map(t => ({ id: t.id, description: t.description, amount: t.amount, merchant: t.merchantName })), null, 2)}`
    }],
    maxTokens: 2048,
  });

  return parseJSON(response);
}

export { callClaude, getText, parseJSON };
