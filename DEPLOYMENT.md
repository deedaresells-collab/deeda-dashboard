# Deeda Dashboard Deployment (Vercel + Supabase)

## 1) Supabase setup

In Supabase SQL editor, run:

- `database/vercel_supabase.sql`

This creates:

- `dashboard_orders`
- `dashboard_products`

## 2) Required environment variables

Set these in Vercel project settings:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Notes:

- The anon key is safe for public read access.
- Keep service role key server-only (Vercel env var only).

## 3) Git and GitHub

```powershell
git config --global --add safe.directory "C:/Users/david/Documents/Codex/2026-05-05/you-are-working-with-a-user"
cd "C:\Users\david\Documents\Codex\2026-05-05\you-are-working-with-a-user"
git add .
git commit -m "Wire products and orders persistence to Supabase for Vercel deploy"
git branch -M main
git remote add origin https://github.com/<YOUR_USERNAME>/deeda-dashboard.git
git push -u origin main
```

## 4) Deploy on Vercel

1. Import the GitHub repo in Vercel.
2. Framework preset: `Other`.
3. Build command: leave empty.
4. Output directory: leave empty.
5. Add all environment variables.
6. Deploy.

## 5) Verification checklist

After deployment:

- Open `/` dashboard and `/store`.
- Add/edit/hide/delete a product; refresh and verify persistence.
- Add/edit orders; refresh and verify persistence.
- Trigger `/api/telegram-daily` and verify bot alert delivery.
