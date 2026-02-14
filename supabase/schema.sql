-- Smart Walker Caregiver Dashboard schema
create extension if not exists "pgcrypto";

create table if not exists caregivers (
  id uuid primary key,
  name text not null,
  role text not null check (role in ('caregiver', 'physio', 'admin'))
);

create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  daily_step_goal int not null,
  exercises jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists residents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  room text not null,
  avatar_url text null,
  daily_step_goal int not null default 300,
  plan_id uuid null references plans(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  resident_id uuid not null references residents(id) on delete cascade,
  type text not null check (type in ('fall', 'near_fall', 'inactivity', 'heavy_lean', 'steps_update')),
  severity text not null check (severity in ('high', 'medium', 'low')),
  ts timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  resident_id uuid not null references residents(id) on delete cascade,
  event_id uuid null references events(id) on delete set null,
  type text not null check (type in ('fall', 'near_fall', 'inactivity', 'heavy_lean')),
  severity text not null check (severity in ('high', 'medium', 'low')),
  status text not null check (status in ('active', 'acknowledged', 'resolved')) default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists daily_stats (
  id uuid primary key default gen_random_uuid(),
  resident_id uuid not null references residents(id) on delete cascade,
  date date not null,
  steps int not null default 0,
  walking_minutes int not null default 0,
  adherence_percent int not null default 0,
  unique (resident_id, date)
);

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  resident_id uuid not null references residents(id) on delete cascade,
  caregiver_id uuid not null references caregivers(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists checkins (
  id uuid primary key default gen_random_uuid(),
  resident_id uuid not null references residents(id) on delete cascade,
  caregiver_id uuid not null references caregivers(id) on delete cascade,
  prompt_type text not null,
  prompt_body text not null,
  status text not null check (status in ('sent', 'responded')) default 'sent',
  sent_at timestamptz not null default now(),
  response_body text null,
  responded_at timestamptz null
);

create index if not exists idx_events_resident_ts on events (resident_id, ts desc);
create index if not exists idx_alerts_status_created on alerts (status, created_at desc);
create index if not exists idx_daily_stats_resident_date on daily_stats (resident_id, date);
create index if not exists idx_checkins_resident_sent on checkins (resident_id, sent_at desc);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_alerts_updated_at on alerts;
create trigger trg_alerts_updated_at
before update on alerts
for each row execute function set_updated_at();

create or replace function create_alert_from_event()
returns trigger as $$
declare
  existing_active uuid;
begin
  if new.type not in ('fall', 'near_fall', 'inactivity', 'heavy_lean') then
    return new;
  end if;

  select id into existing_active
  from alerts
  where resident_id = new.resident_id
    and type = new.type
    and status in ('active', 'acknowledged')
    and created_at > now() - interval '15 minutes'
  order by created_at desc
  limit 1;

  if existing_active is null then
    insert into alerts (resident_id, event_id, type, severity, status)
    values (new.resident_id, new.id, new.type, new.severity, 'active');
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_events_create_alert on events;
create trigger trg_events_create_alert
after insert on events
for each row execute function create_alert_from_event();

alter table caregivers enable row level security;
alter table residents enable row level security;
alter table plans enable row level security;
alter table events enable row level security;
alter table alerts enable row level security;
alter table daily_stats enable row level security;
alter table notes enable row level security;
alter table checkins enable row level security;

-- Demo-friendly policies: public read, writes via service role.
create policy if not exists "public read caregivers" on caregivers for select using (true);
create policy if not exists "public read residents" on residents for select using (true);
create policy if not exists "public read plans" on plans for select using (true);
create policy if not exists "public read events" on events for select using (true);
create policy if not exists "public read alerts" on alerts for select using (true);
create policy if not exists "public read daily_stats" on daily_stats for select using (true);
create policy if not exists "public read notes" on notes for select using (true);
create policy if not exists "public read checkins" on checkins for select using (true);
