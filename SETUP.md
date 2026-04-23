# Setup — Form submission pipeline

The contact form on `/` and `/ambiental` submits to `/api/submit` (a Vercel
Function). The handler:

1. Validates input (required fields + T&C accepted)
2. Appends a row to a Google Sheet
3. Sends a notification email via Resend to configured recipients

## 1. Local env setup

```bash
cp .env.example .env     # if you haven't already
# open .env and fill values
npm install              # installs googleapis + resend
```

## 2. Google Sheets

### 2a. Create service account (one time)

1. Open https://console.cloud.google.com/ → pick or create a project.
2. **APIs & Services → Library** → search **Google Sheets API** → **Enable**.
3. **IAM & Admin → Service Accounts → Create Service Account**. Name it
   anything (e.g. `dorinelpuia-form-writer`). Skip the "grant access" steps.
4. Open the new service account → **Keys → Add Key → Create new key → JSON**.
   A JSON file downloads (keep it safe, never commit).

### 2b. Prepare the sheet

1. Open https://sheets.google.com/ → **Blank**. Rename the first tab to
   `Submissions` (matches `GOOGLE_SHEETS_TAB` default).
2. Copy the spreadsheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/<THIS_IS_THE_ID>/edit`
   Paste it into `GOOGLE_SHEETS_ID`.
3. **Share** the sheet with the service account's `client_email`
   (e.g. `dorinelpuia-form-writer@myproject.iam.gserviceaccount.com`) with
   **Editor** access. Without this, the API returns 403.

### 2c. Put the JSON into .env

Open the downloaded JSON file, copy its ENTIRE content, and paste as the
value of `GOOGLE_SERVICE_ACCOUNT_JSON` in `.env` — wrapped in single quotes
so multi-line newlines inside `private_key` are preserved. On Vercel, paste
the same one-line-or-multi-line JSON as the env var value.

## 3. Resend

1. Sign up at https://resend.com (free tier: 3000 emails/month, 100/day).
2. **Domains → Add Domain** → add `dorinelpuia.ro` → follow DNS setup.
   Without a verified domain, use `onboarding@resend.dev` as
   `EMAIL_FROM` for testing.
3. **API Keys → Create API Key** → scope `Sending access` → paste as
   `RESEND_API_KEY`.
4. `EMAIL_FROM`: e.g. `Dorinel Puia <contact@dorinelpuia.ro>`.
5. `EMAIL_TO`: comma-separated list of recipients, e.g.
   `dorinel@example.com, manager@example.com`.

## 4. Deploy env vars to Vercel

Either via the dashboard (Settings → Environment Variables) or CLI:

```bash
vercel env add GOOGLE_SERVICE_ACCOUNT_JSON production
vercel env add GOOGLE_SHEETS_ID production
vercel env add GOOGLE_SHEETS_TAB production
vercel env add RESEND_API_KEY production
vercel env add EMAIL_FROM production
vercel env add EMAIL_TO production
# optional
vercel env add EMAIL_REPLY_TO production
vercel env add FORM_SECRET production
```

Then redeploy:

```bash
vercel deploy --prod --yes
```

## 5. Sheet columns

The handler auto-creates the header row on first submission. Columns:

| Timestamp | Prenume | Nume | Email | Telefon | Data evenimentului | Oraș | Acord T&C | Pagina sursă | IP | User-Agent |

You can rename the tab or reorder visually in the sheet, but don't
rename column A–K headers — the code matches on position.

## 6. Local testing (optional)

```bash
vercel dev    # runs the function at http://localhost:3000/api/submit
```

Or deploy to a preview URL and test against that.
