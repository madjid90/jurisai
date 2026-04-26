-- ═══════════════════════════════════════════════════════════════════════════
-- JurisAI — Phase 1 : Fondations multi-tenant
-- ═══════════════════════════════════════════════════════════════════════════
-- À exécuter dans Supabase Dashboard → SQL Editor (en une seule fois).
-- Idempotent : peut être relancé sans risque.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Extensions ────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ─── Enums ─────────────────────────────────────────────────────────────────
do $$ begin
  create type public.app_role as enum ('admin', 'manager', 'user');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.plan_type as enum ('starter', 'pro', 'business');
exception when duplicate_object then null; end $$;

-- ─── Table: tenants (entreprises clientes) ─────────────────────────────────
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  siret text,
  idcc text,
  sector text,
  plan public.plan_type not null default 'starter',
  quota_questions integer not null default 100,
  questions_used integer not null default 0,
  quota_reset_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tenants_slug_idx on public.tenants(slug);

-- ─── Table: profiles ───────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  email text not null,
  full_name text,
  job_title text,
  phone text,
  avatar_url text,
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_tenant_idx on public.profiles(tenant_id);

-- ─── Table: user_roles ─────────────────────────────────────────────────────
create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, tenant_id, role)
);

create index if not exists user_roles_user_idx on public.user_roles(user_id);
create index if not exists user_roles_tenant_idx on public.user_roles(tenant_id);

-- ─── Table: invitations ────────────────────────────────────────────────────
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null,
  role public.app_role not null default 'user',
  invited_by uuid not null references auth.users(id) on delete cascade,
  token uuid not null default gen_random_uuid() unique,
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

create index if not exists invitations_tenant_idx on public.invitations(tenant_id);
create index if not exists invitations_email_idx on public.invitations(email);

-- ─── Table: usage_logs ─────────────────────────────────────────────────────
create table if not exists public.usage_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  tokens_used integer,
  cost_cents integer,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists usage_logs_tenant_idx on public.usage_logs(tenant_id, created_at desc);
create index if not exists usage_logs_user_idx on public.usage_logs(user_id, created_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNCTIONS (security definer pour éviter récursion RLS)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.has_role(_user_id uuid, _role public.app_role, _tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role and tenant_id = _tenant_id
  );
$$;

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_member_of_tenant(_user_id uuid, _tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and tenant_id = _tenant_id
  );
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tenants_set_updated_at on public.tenants;
create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function public.set_updated_at();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.tenants enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.invitations enable row level security;
alter table public.usage_logs enable row level security;

-- ─── tenants ───────────────────────────────────────────────────────────────
drop policy if exists "Members can view their tenant" on public.tenants;
create policy "Members can view their tenant"
  on public.tenants for select
  to authenticated
  using (public.is_member_of_tenant(auth.uid(), id));

drop policy if exists "Admins can update their tenant" on public.tenants;
create policy "Admins can update their tenant"
  on public.tenants for update
  to authenticated
  using (public.has_role(auth.uid(), 'admin', id))
  with check (public.has_role(auth.uid(), 'admin', id));

-- ─── profiles ──────────────────────────────────────────────────────────────
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

drop policy if exists "Members can view tenant profiles" on public.profiles;
create policy "Members can view tenant profiles"
  on public.profiles for select
  to authenticated
  using (
    tenant_id is not null
    and public.is_member_of_tenant(auth.uid(), tenant_id)
  );

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ─── user_roles ────────────────────────────────────────────────────────────
drop policy if exists "Users can view own roles" on public.user_roles;
create policy "Users can view own roles"
  on public.user_roles for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Admins can view tenant roles" on public.user_roles;
create policy "Admins can view tenant roles"
  on public.user_roles for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin', tenant_id));

drop policy if exists "Admins can manage tenant roles" on public.user_roles;
create policy "Admins can manage tenant roles"
  on public.user_roles for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin', tenant_id))
  with check (public.has_role(auth.uid(), 'admin', tenant_id));

-- ─── invitations ───────────────────────────────────────────────────────────
drop policy if exists "Admins/managers view tenant invitations" on public.invitations;
create policy "Admins/managers view tenant invitations"
  on public.invitations for select
  to authenticated
  using (
    public.has_role(auth.uid(), 'admin', tenant_id)
    or public.has_role(auth.uid(), 'manager', tenant_id)
  );

drop policy if exists "Admins/managers create invitations" on public.invitations;
create policy "Admins/managers create invitations"
  on public.invitations for insert
  to authenticated
  with check (
    invited_by = auth.uid()
    and (
      public.has_role(auth.uid(), 'admin', tenant_id)
      or public.has_role(auth.uid(), 'manager', tenant_id)
    )
  );

drop policy if exists "Admins delete invitations" on public.invitations;
create policy "Admins delete invitations"
  on public.invitations for delete
  to authenticated
  using (public.has_role(auth.uid(), 'admin', tenant_id));

-- ─── usage_logs ────────────────────────────────────────────────────────────
drop policy if exists "Members view tenant usage" on public.usage_logs;
create policy "Members view tenant usage"
  on public.usage_logs for select
  to authenticated
  using (public.is_member_of_tenant(auth.uid(), tenant_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- DONE — Phase 1 schema ready
-- ═══════════════════════════════════════════════════════════════════════════
