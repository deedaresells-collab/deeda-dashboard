-- Clearance / penny deal tracking for Home Depot & Lowe's (West Virginia)

create table if not exists clearance_deals (
  id uuid primary key default gen_random_uuid(),
  retailer text not null check (retailer in ('homedepot', 'lowes')),
  store_id text not null,
  store_city text,
  sku text not null,
  title text not null,
  brand text,
  price numeric(10, 4),
  was_price numeric(10, 4),
  pct_off integer default 0,
  stock_qty integer,
  alert_type text not null,
  image_url text,
  product_url text,
  category text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  alert_sent_at timestamptz,
  status text not null default 'active' check (status in ('active', 'expired', 'purchased')),
  unique (retailer, store_id, sku)
);

create index if not exists clearance_deals_alert_type_idx on clearance_deals (alert_type);
create index if not exists clearance_deals_last_seen_idx on clearance_deals (last_seen_at desc);
create index if not exists clearance_deals_price_idx on clearance_deals (price);

create table if not exists clearance_scan_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stores_scanned integer default 0,
  deals_found integer default 0,
  new_deals integer default 0,
  alerts_sent integer default 0,
  errors jsonb default '[]'::jsonb,
  status text not null default 'running' check (status in ('running', 'completed', 'failed'))
);

alter table clearance_deals enable row level security;
alter table clearance_scan_runs enable row level security;

drop policy if exists clearance_deals_read_anon on clearance_deals;
create policy clearance_deals_read_anon
  on clearance_deals for select to anon using (true);

drop policy if exists clearance_scan_runs_read_anon on clearance_scan_runs;
create policy clearance_scan_runs_read_anon
  on clearance_scan_runs for select to anon using (true);
