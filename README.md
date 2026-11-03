# WorkLog

A simple dark-mode work diary. Log what you did (date, start/end time, details, links, screenshots),
then print a report for your manager or export to Excel.

No server to run: it is plain HTML/CSS/JS, with **Supabase** providing the database, login and image storage.
That makes it deployable on Vercel (or any static host).

## Setup (about 10 minutes)

### 1. Create the Supabase project (free)
1. Go to https://supabase.com, create a project.
2. Open **SQL Editor → New query**, paste the contents of `schema.sql`, click **Run**.
   This creates the `entries` table and a private `screenshots` bucket, and makes sure
   each person can only see their own data.
3. Open **Project Settings → API** and copy the **Project URL** and the **anon public key**.
4. Paste both into `config.js`.
5. (Optional, easier start) **Authentication → Providers → Email → turn off "Confirm email"**,
   so you can sign in right after creating your account.

### 2. Try it on your computer
Any static server works, for example:

```bash
npx serve .
```

Open the address it prints, click **Create account**, then **Sign in**.

### 3. Deploy to Vercel
1. Push this folder to a GitHub repo (or use `vercel` CLI / drag-and-drop in the Vercel dashboard).
2. In Vercel: **Add New → Project**, import the repo, Framework Preset **Other**.
   Leave Build Command and Output Directory empty. Deploy.
3. In Supabase: **Authentication → URL Configuration**, set **Site URL** to your Vercel address.
   (Only needed if you keep email confirmation on.)

### Good to know
- Once your own account exists you can switch off **Allow new users to sign up** in
  Supabase (Authentication → Sign In / Providers) so nobody else can register.
- Every account sees only its own entries, so your manager can't browse your log directly.
  Give them the **Report → Print / Save as PDF** output (or the Excel export) as proof.

## Files

| File | Purpose |
|---|---|
| `index.html`, `app.js` | main page: sign in, entry list, add/edit form, Excel export |
| `report.html` | printable manager report |
| `common.js` | helpers and all Supabase calls |
| `config.js` | **your** Supabase URL and key |
| `schema.sql` | database setup, run once |
| `style.css` | dark theme |
