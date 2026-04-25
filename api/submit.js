import { google } from 'googleapis';
import { Resend } from 'resend';

const COLUMNS = [
  'Data primirii',
  'Prenume',
  'Nume',
  'Email',
  'Telefon',
  'Data evenimentului',
  'Oraș',
  'Acord T&C',
  'Pagina sursă',
  'IP',
  'Browser',
];

const FIELD_MAP = {
  'First-name': 'Prenume',
  'Last-name': 'Nume',
  'email-address': 'Email',
  'Phone-number': 'Telefon',
  'Business-name': 'Data evenimentului',
  'field': 'Oraș',
};

function requiredFieldsPresent(body) {
  const required = ['First-name', 'Last-name', 'email-address', 'Business-name'];
  for (const k of required) {
    if (!body[k] || String(body[k]).trim() === '') return k;
  }
  if (!body.tc_accepted) return 'tc_accepted';
  return null;
}

function validEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

function getServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
  let sa;
  try {
    sa = JSON.parse(raw);
  } catch (e) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ' + e.message);
  }
  if (sa.private_key && sa.private_key.includes('\\n')) {
    sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  }
  return sa;
}

async function getSheetsClient() {
  const sa = getServiceAccount();
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

async function ensureHeaderRow(sheets, spreadsheetId, tab) {
  const range = `${tab}!A1:K1`;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const values = res.data.values;
  const needsHeader = !values || values.length === 0 || values[0].length < COLUMNS.length;
  if (needsHeader) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: { values: [COLUMNS] },
    });
  }
}

async function appendRow(sheets, spreadsheetId, tab, row) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tab}!A:K`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

function buildEmailHtml({ data, timestamp, sourcePage }) {
  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const rows = [
    ['Prenume', data['First-name']],
    ['Nume', data['Last-name']],
    ['Email', data['email-address']],
    ['Telefon', data['Phone-number'] || '—'],
    ['Data evenimentului', data['Business-name']],
    ['Oraș', data['field'] || '—'],
  ];
  const tableRows = rows
    .map(
      ([k, v]) => `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #eee;font-weight:600;color:#555;width:40%;">${esc(k)}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #eee;color:#111;">${esc(v)}</td>
      </tr>`
    )
    .join('');

  return `<!doctype html>
<html lang="ro"><head><meta charset="utf-8"><title>Nouă solicitare — dorinelpuia.ro</title></head>
<body style="margin:0;padding:24px;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06);">
    <div style="background:#111;color:#fff;padding:20px 24px;">
      <h1 style="margin:0;font-size:20px;font-weight:700;">Solicitare nouă prin formular</h1>
      <p style="margin:6px 0 0;opacity:.75;font-size:13px;">dorinelpuia.ro · ${esc(sourcePage)}</p>
    </div>
    <div style="padding:20px 24px;">
      <p style="margin:0 0 16px;color:#555;font-size:14px;">Primit la <strong>${esc(timestamp)}</strong></p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        ${tableRows}
      </table>
      <p style="margin:24px 0 0;font-size:12px;color:#888;">Acest email este generat automat. Răspunde direct la această adresă pentru a intra în contact cu solicitantul.</p>
    </div>
  </div>
</body></html>`;
}

function buildEmailText({ data, timestamp, sourcePage }) {
  return [
    'Solicitare nouă prin formularul de pe dorinelpuia.ro',
    '',
    `Primit la: ${timestamp}`,
    `Pagina: ${sourcePage}`,
    '',
    `Prenume: ${data['First-name']}`,
    `Nume: ${data['Last-name']}`,
    `Email: ${data['email-address']}`,
    `Telefon: ${data['Phone-number'] || '—'}`,
    `Data evenimentului: ${data['Business-name']}`,
    `Oraș: ${data['field'] || '—'}`,
  ].join('\n');
}

function parseAddrList(s) {
  return (s || '')
    .split(',')
    .map((a) => a.trim().replace(/^["']|["']$/g, '').trim())
    .filter(Boolean);
}

async function sendEmail({ data, timestamp, sourcePage }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = (process.env.EMAIL_FROM || '').trim().replace(/^["']|["']$/g, '');
  const to = parseAddrList(process.env.EMAIL_TO);
  const bcc = parseAddrList(process.env.EMAIL_TO_BCC);
  if (!apiKey || !from || to.length === 0) {
    return { skipped: true, reason: 'Resend vars missing (RESEND_API_KEY / EMAIL_FROM / EMAIL_TO)' };
  }
  const replyToFromEnv = (process.env.EMAIL_REPLY_TO || '').trim().replace(/^["']|["']$/g, '');
  const replyTo = replyToFromEnv || data['email-address'];

  const resend = new Resend(apiKey);
  const subject = `[dorinelpuia.ro] Nouă cerere: ${data['First-name']} ${data['Last-name']} — ${data['Business-name']}`;
  const html = buildEmailHtml({ data, timestamp, sourcePage });
  const text = buildEmailText({ data, timestamp, sourcePage });

  const payload = {
    from,
    to,
    replyTo,
    subject,
    html,
    text,
    headers: {
      'X-Entity-Ref-ID': `dpr-${Date.now()}`,
      'X-Source': 'dorinelpuia.ro',
    },
  };
  if (bcc.length) payload.bcc = bcc;

  const res = await resend.emails.send(payload);
  return { skipped: false, id: res?.data?.id, recipients: { to: to.length, bcc: bcc.length } };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

  if (process.env.FORM_SECRET && body._secret !== process.env.FORM_SECRET) {
    return res.status(403).json({ ok: false, error: 'Invalid secret' });
  }

  if (body.website) {
    return res.status(200).json({ ok: true, honeypot: true });
  }

  const missing = requiredFieldsPresent(body);
  if (missing) {
    return res.status(400).json({ ok: false, error: `Câmp lipsă sau invalid: ${missing}` });
  }
  if (!validEmail(body['email-address'])) {
    return res.status(400).json({ ok: false, error: 'Email invalid' });
  }

  const timestamp = new Date().toISOString();
  const sourcePage = (body._source || req.headers.referer || '/').toString();
  const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || '';
  const ua = (req.headers['user-agent'] || '').toString().slice(0, 255);

  const row = [
    timestamp,
    body['First-name'] || '',
    body['Last-name'] || '',
    body['email-address'] || '',
    body['Phone-number'] || '',
    body['Business-name'] || '',
    body['field'] || '',
    body.tc_accepted ? 'DA' : 'NU',
    sourcePage,
    ip,
    ua,
  ];

  const result = { sheet: null, email: null };

  try {
    const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
    const tab = process.env.GOOGLE_SHEETS_TAB || 'Submissions';
    if (!spreadsheetId) throw new Error('GOOGLE_SHEETS_ID is not set');
    const sheets = await getSheetsClient();
    await ensureHeaderRow(sheets, spreadsheetId, tab);
    await appendRow(sheets, spreadsheetId, tab, row);
    result.sheet = 'ok';
  } catch (e) {
    console.error('Sheets error:', e?.message || e);
    result.sheet = `error: ${e?.message || e}`;
  }

  try {
    const r = await sendEmail({ data: body, timestamp, sourcePage });
    result.email = r.skipped ? `skipped: ${r.reason}` : `sent: ${r.id || 'ok'}`;
  } catch (e) {
    console.error('Email error:', e?.message || e);
    result.email = `error: ${e?.message || e}`;
  }

  const hardFail = result.sheet?.startsWith('error:') && result.email?.startsWith('error:');
  if (hardFail) {
    return res.status(500).json({ ok: false, error: 'Both Sheets and Email failed', detail: result });
  }

  return res.status(200).json({ ok: true, ...result });
}
