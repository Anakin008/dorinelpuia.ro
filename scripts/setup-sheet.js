import { google } from 'googleapis';
import fs from 'node:fs';

function parseEnv(text) {
  const vars = {};
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].replace(/\r$/, '');
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) { i++; continue; }
    const key = m[1];
    const val = m[2];
    if (val.trimStart().startsWith('{')) {
      const buf = [val];
      let brace = (val.match(/\{/g) || []).length - (val.match(/\}/g) || []).length;
      let j = i + 1;
      while (brace > 0 && j < lines.length) {
        const nxt = lines[j].replace(/\r$/, '');
        buf.push(nxt);
        brace += (nxt.match(/\{/g) || []).length - (nxt.match(/\}/g) || []).length;
        j++;
      }
      vars[key] = buf.join('\n');
      i = j;
      continue;
    }
    const s = val.trim();
    if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
      vars[key] = s.slice(1, -1);
    } else {
      vars[key] = s;
    }
    i++;
  }
  return vars;
}

const HEADERS = [
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

const COLUMN_WIDTHS = [170, 110, 110, 220, 130, 150, 120, 90, 180, 120, 260];

async function main() {
  const env = parseEnv(fs.readFileSync('.env', 'utf-8'));
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON in .env');
  if (!env.GOOGLE_SHEETS_ID) throw new Error('Missing GOOGLE_SHEETS_ID in .env');

  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  if (sa.private_key && sa.private_key.includes('\\n')) {
    sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  }

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  await auth.authorize();

  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = env.GOOGLE_SHEETS_ID;
  const tab = env.GOOGLE_SHEETS_TAB || 'Submissions';

  console.log(`Preparing sheet "${tab}" in spreadsheet ${spreadsheetId}...`);

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  let tabInfo = meta.data.sheets.find((s) => s.properties.title === tab);

  if (!tabInfo) {
    const r = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tab, gridProperties: { rowCount: 1000, columnCount: HEADERS.length } } } }] },
    });
    tabInfo = { properties: r.data.replies[0].addSheet.properties };
    console.log(`  + Created tab "${tab}" (sheetId=${tabInfo.properties.sheetId})`);
  } else {
    console.log(`  = Tab "${tab}" already exists (sheetId=${tabInfo.properties.sheetId})`);
  }
  const sheetId = tabInfo.properties.sheetId;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tab}!A1:${String.fromCharCode(64 + HEADERS.length)}1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADERS] },
  });
  console.log(`  + Wrote ${HEADERS.length} headers`);

  const requests = [
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEADERS.length },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.12, green: 0.12, blue: 0.14 },
            textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 11 },
            horizontalAlignment: 'LEFT',
            verticalAlignment: 'MIDDLE',
            padding: { top: 8, bottom: 8, left: 10, right: 10 },
            wrapStrategy: 'CLIP',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding,wrapStrategy)',
      },
    },
    ...COLUMN_WIDTHS.map((w, idx) => ({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: idx, endIndex: idx + 1 },
        properties: { pixelSize: w },
        fields: 'pixelSize',
      },
    })),
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 36 },
        fields: 'pixelSize',
      },
    },
  ];

  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  console.log('  + Applied formatting (freeze row 1, bold white-on-dark header, column widths, row height 36px)');

  console.log('\nDone. Sheet is ready for form submissions.');
  console.log(`View: https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);
}

main().catch((e) => {
  console.error('FAILED:', e?.message || e);
  process.exit(1);
});
