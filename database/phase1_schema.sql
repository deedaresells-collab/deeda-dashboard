create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact text,
  created_at timestamptz not null default now()
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  category_id uuid references categories(id),
  aliases text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id bigint primary key,
  customer_id uuid references customers(id),
  order_date date not null,
  status text not null check (
    status in (
      'New Order',
      'Paid',
      'Submitted',
      'Ordered',
      'Waiting to Ship',
      'Shipped',
      'Delivered',
      'Completed',
      'Issue / Refund'
    )
  ),
  payment_method text,
  tracking_number text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id bigint not null references orders(id) on delete cascade,
  product_id uuid references products(id),
  product_name text not null,
  category_id uuid references categories(id),
  size text,
  quantity integer not null default 1,
  sale_price numeric(10, 2) not null default 0,
  product_cost numeric(10, 2) not null default 0,
  shipping_cost numeric(10, 2) not null default 0,
  line_revenue numeric(10, 2) generated always as (quantity * sale_price) stored,
  line_cost numeric(10, 2) generated always as (quantity * (product_cost + shipping_cost)) stored,
  line_profit numeric(10, 2) generated always as ((quantity * sale_price) - (quantity * (product_cost + shipping_cost))) stored,
  created_at timestamptz not null default now()
);

create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  order_id bigint references orders(id) on delete cascade,
  alert_type text not null,
  title text not null,
  body text,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create or replace view monthly_analytics as
select
  date_trunc('month', o.order_date)::date as month,
  count(distinct o.id) as total_orders,
  sum(oi.quantity) as units_sold,
  sum(oi.line_revenue) as revenue,
  sum(oi.line_cost) as cost,
  sum(oi.line_profit) as profit,
  case when sum(oi.line_revenue) > 0 then sum(oi.line_profit) / sum(oi.line_revenue) else 0 end as margin,
  case when count(distinct o.id) > 0 then sum(oi.line_profit) / count(distinct o.id) else 0 end as avg_profit_per_order
from orders o
join order_items oi on oi.order_id = o.id
group by 1;

insert into categories (name)
values
  ('Shoes'),
  ('Hoodies'),
  ('Shirts'),
  ('Longsleeves'),
  ('Pants'),
  ('Jeans'),
  ('Shorts'),
  ('Socks'),
  ('Jackets'),
  ('SET'),
  ('Watches'),
  ('Glasses'),
  ('Bags'),
  ('Belt'),
  ('Jewelry'),
  ('Membership'),
  ('Other')
on conflict (name) do nothing;
