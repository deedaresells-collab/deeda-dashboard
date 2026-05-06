create table if not exists dashboard_orders (
  id bigint generated always as identity primary key,
  position integer not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists dashboard_products (
  id bigint generated always as identity primary key,
  position integer not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table dashboard_orders enable row level security;
alter table dashboard_products enable row level security;

drop policy if exists dashboard_orders_read_anon on dashboard_orders;
create policy dashboard_orders_read_anon
  on dashboard_orders
  for select
  to anon
  using (true);

drop policy if exists dashboard_products_read_anon on dashboard_products;
create policy dashboard_products_read_anon
  on dashboard_products
  for select
  to anon
  using (true);

-- Writes happen through Vercel server functions using service role key.
