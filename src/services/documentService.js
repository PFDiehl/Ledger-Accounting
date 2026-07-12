// Document management service
// Upload to S3, generate presigned download URLs, trigger OCR via AWS Textract

import { randomUUID } from 'crypto';

// Lazy-load AWS SDK to avoid requiring it when not configured
async function getS3() {
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } =
    await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

  const client = new S3Client({
    region:      process.env.S3_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  return { client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, getSignedUrl };
}

async function getTextract() {
  const { TextractClient, DetectDocumentTextCommand } = await import('@aws-sdk/client-textract');
  const client = new TextractClient({
    region:      process.env.S3_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  return { client, DetectDocumentTextCommand };
}

const BUCKET = process.env.S3_BUCKET ?? 'ledger-attachments';

// ── Upload a file buffer to S3 ────────────────────────────────────────────────

export async function uploadToS3(buffer, { orgId, entityType, entityId, filename, mimeType }) {
  const ext     = filename.split('.').pop() ?? 'bin';
  const s3Key   = `${orgId}/${entityType}/${entityId}/${randomUUID()}.${ext}`;

  if (!process.env.AWS_ACCESS_KEY_ID) {
    // Dev mode: return a mock key without uploading
    console.log(`[docs] DEV: would upload ${filename} to s3://${BUCKET}/${s3Key}`);
    return { s3Key, url: `https://${BUCKET}.s3.amazonaws.com/${s3Key}` };
  }

  const { client, PutObjectCommand } = await getS3();
  await client.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         s3Key,
    Body:        buffer,
    ContentType: mimeType,
    Metadata:    { orgId, entityType, entityId, originalFilename: filename },
  }));

  return { s3Key };
}

// ── Generate a presigned download URL (expires in 1 hour) ────────────────────

export async function getPresignedUrl(s3Key, expiresIn = 3600) {
  if (!process.env.AWS_ACCESS_KEY_ID) {
    return `https://${BUCKET}.s3.amazonaws.com/${s3Key}?dev=true`;
  }

  const { client, GetObjectCommand, getSignedUrl } = await getS3();
  return getSignedUrl(client, new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }), { expiresIn });
}

// ── Delete from S3 ────────────────────────────────────────────────────────────

export async function deleteFromS3(s3Key) {
  if (!process.env.AWS_ACCESS_KEY_ID) return;
  const { client, DeleteObjectCommand } = await getS3();
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: s3Key }));
}

// ── OCR via AWS Textract ──────────────────────────────────────────────────────

export async function extractTextFromS3(s3Key) {
  if (!process.env.AWS_ACCESS_KEY_ID) {
    return 'OCR not available in development mode. Configure AWS credentials to enable.';
  }

  const { client, DetectDocumentTextCommand } = await getTextract();
  const response = await client.send(new DetectDocumentTextCommand({
    Document: { S3Object: { Bucket: BUCKET, Name: s3Key } },
  }));

  const lines = response.Blocks
    ?.filter(b => b.BlockType === 'LINE')
    .map(b => b.Text)
    .filter(Boolean) ?? [];

  return lines.join('\n');
}

// ── Parse receipt data from OCR text ─────────────────────────────────────────
// Simple heuristic parser — extracts total, date, vendor from common receipt formats

export function parseReceiptFromOCR(ocrText) {
  const lines  = ocrText.split('\n').map(l => l.trim()).filter(Boolean);
  const result = { vendor: null, total: null, date: null, rawText: ocrText };

  // Vendor: usually first non-trivial line
  result.vendor = lines.find(l => l.length > 3 && !/^\d/.test(l)) ?? null;

  // Total: look for "total", "amount due", "grand total" followed by a number
  const totalPattern = /(?:total|amount due|grand total|balance due)[:\s]*\$?([\d,]+\.?\d*)/i;
  for (const line of lines) {
    const m = line.match(totalPattern);
    if (m) { result.total = parseFloat(m[1].replace(',','')); break; }
  }

  // Fallback: largest dollar amount in document
  if (!result.total) {
    const amounts = lines
      .flatMap(l => [...l.matchAll(/\$?([\d,]+\.\d{2})/g)])
      .map(m => parseFloat(m[1].replace(',','')))
      .filter(n => !isNaN(n) && n > 0);
    result.total = amounts.length ? Math.max(...amounts) : null;
  }

  // Date: look for date patterns
  const datePatterns = [
    /(\d{1,2}\/\d{1,2}\/\d{2,4})/,
    /(\w+ \d{1,2},?\s*\d{4})/,
    /(\d{4}-\d{2}-\d{2})/,
  ];
  for (const line of lines) {
    for (const pat of datePatterns) {
      const m = line.match(pat);
      if (m) { result.date = m[1]; break; }
    }
    if (result.date) break;
  }

  return result;
}
