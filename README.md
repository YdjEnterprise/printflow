# PrintFlow — Job Management System

## Quick Deploy (3 steps)

### Step 1: Set up Supabase Database
1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Open your **printflow** project
3. Click **SQL Editor** → **New Query**
4. Paste the contents of `supabase-schema.sql` and click **Run**

### Step 2: Push to GitHub
1. Go to [github.com/new](https://github.com/new)
2. Name: `printflow`, click **Create repository**
3. Upload ALL files from this folder (drag & drop works)

### Step 3: Deploy on Vercel
1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your `printflow` repository
3. Add **Environment Variables**:
   - `VITE_SUPABASE_URL` = your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` = your Supabase anon key
4. Click **Deploy** — done!

### Connect Your Domain
1. In Vercel: **Settings → Domains** → add `printflow.yourdomain.com`
2. In your DNS: add a CNAME record pointing to `cname.vercel-dns.com`

---

## Local Development
```bash
npm install
npm run dev
```
Opens at http://localhost:5173

## Architecture
- **Frontend**: React + Vite (hosted on Vercel)
- **Database**: Supabase PostgreSQL (auto-syncs)
- **Auth**: Currently open — add Supabase Auth for login

## How Data Sync Works
- On page load: fetches all data from Supabase
- On any change: diffs local state vs previous state, writes only changes
- Multiple staff see the same data (refresh to see others' changes)
- No data lost on refresh — everything persists in the database
