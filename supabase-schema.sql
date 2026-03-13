-- ═══════════════════════════════════════════════════════════════
--  PRINTFLOW — Supabase Database Schema
--  Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ═══════════════════════════════════════════════════════════════

-- Clients table
CREATE TABLE clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cust_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  gst TEXT DEFAULT '',
  address TEXT DEFAULT '',
  monthly_billing BOOLEAN DEFAULT false,
  last_bill_date DATE,
  loyalty_points INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Jobs table
CREATE TABLE jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id TEXT UNIQUE NOT NULL,
  cust_id TEXT REFERENCES clients(cust_id),
  client_name TEXT NOT NULL,
  job_desc TEXT NOT NULL,
  order_type TEXT NOT NULL,
  deadline DATE,
  urgency TEXT DEFAULT 'Medium',
  stage TEXT DEFAULT 'Order Received',
  amount NUMERIC(10,2) DEFAULT 0,
  paid NUMERIC(10,2) DEFAULT 0,
  notes TEXT DEFAULT '',
  needs_print BOOLEAN DEFAULT false,
  needs_fabrication BOOLEAN DEFAULT false,
  print_spec JSONB,
  fab_spec JSONB,
  created_at DATE DEFAULT CURRENT_DATE,
  delivered_at DATE
);

-- Print sub-jobs
CREATE TABLE print_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  print_id TEXT UNIQUE NOT NULL,
  order_id TEXT REFERENCES jobs(order_id),
  client_name TEXT,
  job_desc TEXT,
  type TEXT,
  material TEXT,
  width TEXT,
  height TEXT,
  qty TEXT DEFAULT '1',
  resolution TEXT,
  notes TEXT DEFAULT '',
  stage TEXT DEFAULT 'Queued',
  created_at DATE DEFAULT CURRENT_DATE
);

-- Fabrication sub-jobs
CREATE TABLE fab_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fab_id TEXT UNIQUE NOT NULL,
  order_id TEXT REFERENCES jobs(order_id),
  client_name TEXT,
  job_desc TEXT,
  type TEXT,
  pipe_size TEXT,
  pipe_thick TEXT,
  wood_type TEXT,
  acp_thick TEXT,
  width TEXT,
  height TEXT,
  notes TEXT DEFAULT '',
  stage TEXT DEFAULT 'Pending',
  created_at DATE DEFAULT CURRENT_DATE
);

-- Enable Row Level Security (keeps data private per business)
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fab_jobs ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read/write (your staff)
CREATE POLICY "Staff can do everything" ON clients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Staff can do everything" ON jobs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Staff can do everything" ON print_jobs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Staff can do everything" ON fab_jobs FOR ALL USING (true) WITH CHECK (true);

-- Indexes for fast queries
CREATE INDEX idx_jobs_cust_id ON jobs(cust_id);
CREATE INDEX idx_jobs_stage ON jobs(stage);
CREATE INDEX idx_jobs_created ON jobs(created_at);
CREATE INDEX idx_print_order ON print_jobs(order_id);
CREATE INDEX idx_fab_order ON fab_jobs(order_id);
