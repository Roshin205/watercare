-- Initial WaterCare schema. Apply through Supabase SQL editor or CLI.
-- This migration creates new objects only and never drops or overwrites records.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    full_name text,
    phone text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.organization_memberships (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete restrict,
    user_id uuid not null references auth.users(id) on delete cascade,
    role text not null check (role in ('administrator', 'manager', 'employee')),
    status text not null default 'active' check (status in ('active', 'invited', 'suspended')),
    created_at timestamptz not null default now(),
    unique (organization_id, user_id)
);

create table if not exists public.organization_settings (
    organization_id uuid primary key references public.organizations(id) on delete restrict,
    name text,
    support_contact text,
    time_zone text not null default 'UTC',
    date_format text not null default 'YYYY-MM-DD',
    time_format text not null default '24h',
    updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete restrict,
    user_id uuid not null references auth.users(id) on delete cascade,
    appearance text not null default 'system' check (appearance in ('system', 'light', 'dark')),
    notification_preferences jsonb not null default '{}'::jsonb,
    date_format text,
    time_format text,
    time_zone text,
    updated_at timestamptz not null default now(),
    unique (organization_id, user_id)
);

create table if not exists public.clients (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete restrict,
    name text not null,
    organization_name text,
    contact_person text,
    phone text,
    email text,
    address text,
    category text,
    notes text,
    is_active boolean not null default true,
    created_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    unique (id, organization_id)
);

create table if not exists public.engineers (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete restrict,
    user_id uuid references auth.users(id) on delete set null,
    full_name text not null,
    email text,
    phone text,
    specialization text,
    availability text,
    is_active boolean not null default true,
    created_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    unique (organization_id, email),
    unique (id, organization_id)
);

create table if not exists public.projects (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete restrict,
    client_id uuid not null,
    name text not null,
    category text,
    location text,
    description text,
    start_date date,
    scheduled_date date,
    scheduled_time time,
    status text not null default 'Planned' check (status in ('Planned', 'Scheduled', 'In Progress', 'Completed', 'On Hold', 'Cancelled')),
    notes text,
    created_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    unique (id, organization_id),
    foreign key (client_id, organization_id) references public.clients(id, organization_id) on delete restrict
);

create table if not exists public.project_engineers (
    organization_id uuid not null references public.organizations(id) on delete restrict,
    project_id uuid not null,
    engineer_id uuid not null,
    created_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    primary key (project_id, engineer_id),
    foreign key (project_id, organization_id) references public.projects(id, organization_id) on delete restrict,
    foreign key (engineer_id, organization_id) references public.engineers(id, organization_id) on delete restrict
);

create table if not exists public.project_tasks (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete restrict,
    project_id uuid not null,
    engineer_id uuid,
    title text not null,
    description text,
    scheduled_date date not null,
    scheduled_time time,
    location text,
    status text not null default 'Scheduled' check (status in ('Planned', 'Scheduled', 'In Progress', 'Completed', 'On Hold', 'Cancelled')),
    notes text,
    created_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    unique (id, organization_id),
    foreign key (project_id, organization_id) references public.projects(id, organization_id) on delete restrict,
    foreign key (engineer_id, organization_id) references public.engineers(id, organization_id) on delete restrict
);

create table if not exists public.cleaning_records (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete restrict,
    client_id uuid not null,
    engineer_id uuid,
    site_name text,
    tank_identification text,
    tank_type text,
    capacity numeric check (capacity is null or capacity >= 0),
    location text,
    cleaning_date date not null,
    cleaning_time time,
    procedure text,
    materials_used text,
    observations text,
    status text not null default 'Scheduled' check (status in ('Scheduled', 'In Progress', 'Completed', 'Overdue', 'Cancelled')),
    next_recommended_date date,
    notes text,
    created_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    unique (id, organization_id),
    foreign key (client_id, organization_id) references public.clients(id, organization_id) on delete restrict,
    foreign key (engineer_id, organization_id) references public.engineers(id, organization_id) on delete restrict
);

create table if not exists public.water_testing_records (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete restrict,
    client_id uuid not null,
    project_id uuid,
    engineer_id uuid,
    sampling_location text,
    collection_date date not null,
    collection_time time,
    water_source text,
    testing_category text,
    sample_identification text,
    test_parameters jsonb not null default '[]'::jsonb,
    test_results jsonb not null default '{}'::jsonb,
    reference_limits jsonb not null default '{}'::jsonb,
    interpretation text,
    laboratory_details text,
    status text not null default 'Collected',
    notes text,
    created_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    unique (id, organization_id),
    foreign key (client_id, organization_id) references public.clients(id, organization_id) on delete restrict,
    foreign key (project_id, organization_id) references public.projects(id, organization_id) on delete restrict,
    foreign key (engineer_id, organization_id) references public.engineers(id, organization_id) on delete restrict
);

create table if not exists public.uploaded_documents (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete restrict,
    related_type text not null check (related_type in ('project', 'client', 'cleaning_record', 'water_testing')),
    related_id uuid not null,
    original_filename text not null,
    storage_path text not null unique,
    mime_type text not null,
    file_size bigint not null check (file_size > 0 and file_size <= 15728640),
    uploaded_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    deleted_at timestamptz
);

create table if not exists public.notifications (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete restrict,
    user_id uuid references auth.users(id) on delete cascade,
    title text not null,
    message text not null,
    read_at timestamptz,
    created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
    id bigint generated always as identity primary key,
    organization_id uuid,
    actor_id uuid references auth.users(id) on delete set null,
    table_name text not null,
    record_id text,
    action text not null,
    old_data jsonb,
    new_data jsonb,
    created_at timestamptz not null default now()
);

create or replace function public.watercare_create_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id) values (NEW.id) on conflict (id) do nothing;
    return NEW;
end;
$$;
revoke all on function public.watercare_create_profile() from public;
drop trigger if exists watercare_auth_user_profile on auth.users;
create trigger watercare_auth_user_profile
after insert on auth.users
for each row execute function public.watercare_create_profile();
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

create index if not exists memberships_user_org_idx on public.organization_memberships(user_id, organization_id) where status = 'active';
create index if not exists clients_org_name_idx on public.clients(organization_id, name) where deleted_at is null;
create index if not exists engineers_org_name_idx on public.engineers(organization_id, full_name) where deleted_at is null;
create index if not exists projects_org_schedule_idx on public.projects(organization_id, scheduled_date, status) where deleted_at is null;
create index if not exists projects_client_idx on public.projects(organization_id, client_id) where deleted_at is null;
create index if not exists project_tasks_schedule_idx on public.project_tasks(organization_id, scheduled_date, status) where deleted_at is null;
create index if not exists project_engineers_engineer_idx on public.project_engineers(organization_id, engineer_id);
create index if not exists cleaning_schedule_idx on public.cleaning_records(organization_id, cleaning_date, status) where deleted_at is null;
create index if not exists cleaning_client_idx on public.cleaning_records(organization_id, client_id) where deleted_at is null;
create index if not exists water_testing_schedule_idx on public.water_testing_records(organization_id, collection_date, status) where deleted_at is null;
create index if not exists water_testing_client_idx on public.water_testing_records(organization_id, client_id) where deleted_at is null;
create index if not exists documents_related_idx on public.uploaded_documents(organization_id, related_type, related_id) where deleted_at is null;
create index if not exists audit_org_time_idx on public.audit_logs(organization_id, created_at desc);

create or replace function public.is_watercare_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.organization_memberships m
        where m.organization_id = target_org
          and m.user_id = auth.uid()
          and m.status = 'active'
    );
$$;
revoke all on function public.is_watercare_member(uuid) from public;
grant execute on function public.is_watercare_member(uuid) to authenticated;

create or replace function public.watercare_has_role(target_org uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.organization_memberships m
        where m.organization_id = target_org
          and m.user_id = auth.uid()
          and m.status = 'active'
          and m.role = any(allowed_roles)
    );
$$;
revoke all on function public.watercare_has_role(uuid, text[]) from public;
grant execute on function public.watercare_has_role(uuid, text[]) to authenticated;

create or replace function public.watercare_assigned_engineer(target_org uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
    select e.id from public.engineers e
    where e.organization_id = target_org and e.user_id = auth.uid()
      and e.is_active and e.deleted_at is null
    limit 1
$$;
revoke all on function public.watercare_assigned_engineer(uuid) from public;
grant execute on function public.watercare_assigned_engineer(uuid) to authenticated;

create or replace function public.watercare_project_assigned(target_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.project_engineers pe
        join public.engineers e on e.id = pe.engineer_id
        where pe.project_id = target_project
          and e.user_id = auth.uid() and e.is_active and e.deleted_at is null
    )
$$;
revoke all on function public.watercare_project_assigned(uuid) from public;
grant execute on function public.watercare_project_assigned(uuid) to authenticated;

create or replace function public.watercare_audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    old_json jsonb;
    new_json jsonb;
    row_json jsonb;
begin
    if TG_OP <> 'INSERT' then old_json := to_jsonb(OLD); end if;
    if TG_OP <> 'DELETE' then new_json := to_jsonb(NEW); end if;
    row_json := coalesce(new_json, old_json);
    insert into public.audit_logs (organization_id, actor_id, table_name, record_id, action, old_data, new_data)
    values (
        nullif(row_json ->> 'organization_id', '')::uuid,
        coalesce(
            auth.uid(),
            nullif(row_json ->> 'updated_by', '')::uuid,
            nullif(row_json ->> 'created_by', '')::uuid,
            nullif(row_json ->> 'uploaded_by', '')::uuid
        ),
        TG_TABLE_NAME,
        coalesce(
            new_json ->> 'id',
            old_json ->> 'id',
            concat_ws(':', new_json ->> 'project_id', new_json ->> 'engineer_id'),
            concat_ws(':', old_json ->> 'project_id', old_json ->> 'engineer_id')
        ),
        TG_OP,
        old_json,
        new_json
    );
    if TG_OP = 'DELETE' then return OLD; end if;
    return NEW;
end;
$$;
revoke all on function public.watercare_audit_row() from public;

do $$
declare table_to_audit text;
begin
    foreach table_to_audit in array array['clients','engineers','projects','project_engineers','project_tasks','cleaning_records','water_testing_records','uploaded_documents'] loop
        execute format('drop trigger if exists watercare_audit on public.%I', table_to_audit);
        execute format('create trigger watercare_audit after insert or update or delete on public.%I for each row execute function public.watercare_audit_row()', table_to_audit);
    end loop;
end;
$$;

create or replace function public.watercare_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    NEW.updated_at = now();
    return NEW;
end;
$$;
revoke all on function public.watercare_touch_updated_at() from public;

do $$
declare table_to_touch text;
begin
    foreach table_to_touch in array array['profiles','organizations','organization_settings','user_settings','clients','engineers','projects','project_tasks','cleaning_records','water_testing_records'] loop
        execute format('drop trigger if exists watercare_touch_updated_at on public.%I', table_to_touch);
        execute format('create trigger watercare_touch_updated_at before update on public.%I for each row execute function public.watercare_touch_updated_at()', table_to_touch);
    end loop;
end;
$$;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.organization_settings enable row level security;
alter table public.user_settings enable row level security;
alter table public.clients enable row level security;
alter table public.engineers enable row level security;
alter table public.projects enable row level security;
alter table public.project_engineers enable row level security;
alter table public.project_tasks enable row level security;
alter table public.cleaning_records enable row level security;
alter table public.water_testing_records enable row level security;
alter table public.uploaded_documents enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_self on public.profiles for all to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy organizations_member_read on public.organizations for select to authenticated using (public.is_watercare_member(id));
create policy memberships_member_read on public.organization_memberships for select to authenticated using (user_id = auth.uid() or public.is_watercare_member(organization_id));
create policy organization_settings_member_read on public.organization_settings for select to authenticated using (public.is_watercare_member(organization_id));
create policy organization_settings_admin_write on public.organization_settings for all to authenticated
    using (exists (select 1 from public.organization_memberships m where m.organization_id = organization_settings.organization_id and m.user_id = auth.uid() and m.role = 'administrator' and m.status = 'active'))
    with check (exists (select 1 from public.organization_memberships m where m.organization_id = organization_settings.organization_id and m.user_id = auth.uid() and m.role = 'administrator' and m.status = 'active'));
create policy user_settings_member_scope on public.user_settings for all to authenticated
    using (user_id = auth.uid() and public.is_watercare_member(organization_id))
    with check (user_id = auth.uid() and public.is_watercare_member(organization_id));
create policy clients_org_read on public.clients for select to authenticated using (
    public.is_watercare_member(organization_id) and (
        public.watercare_has_role(organization_id, array['administrator','manager']) or
        exists (select 1 from public.projects p where p.organization_id = clients.organization_id and p.client_id = clients.id and public.watercare_project_assigned(p.id)) or
        exists (select 1 from public.cleaning_records c where c.organization_id = clients.organization_id and c.client_id = clients.id and c.engineer_id = public.watercare_assigned_engineer(c.organization_id)) or
        exists (select 1 from public.water_testing_records w where w.organization_id = clients.organization_id and w.client_id = clients.id and w.engineer_id = public.watercare_assigned_engineer(w.organization_id))
    )
);
create policy clients_manager_insert on public.clients for insert to authenticated with check (
    public.watercare_has_role(organization_id, array['administrator','manager'])
);
create policy clients_manager_update on public.clients for update to authenticated using (
    public.watercare_has_role(organization_id, array['administrator','manager'])
) with check (public.watercare_has_role(organization_id, array['administrator','manager']));

create policy engineers_manager_insert on public.engineers for insert to authenticated with check (
    public.watercare_has_role(organization_id, array['administrator','manager'])
);
create policy engineers_manager_update on public.engineers for update to authenticated using (
    public.watercare_has_role(organization_id, array['administrator','manager'])
) with check (public.watercare_has_role(organization_id, array['administrator','manager']));

create policy projects_manager_insert on public.projects for insert to authenticated with check (
    public.watercare_has_role(organization_id, array['administrator','manager'])
);
create policy projects_manager_update on public.projects for update to authenticated using (
    public.watercare_has_role(organization_id, array['administrator','manager'])
) with check (public.watercare_has_role(organization_id, array['administrator','manager']));

create policy project_engineers_manager_insert on public.project_engineers for insert to authenticated with check (
    public.watercare_has_role(organization_id, array['administrator','manager'])
);
create policy project_engineers_manager_update on public.project_engineers for update to authenticated using (
    public.watercare_has_role(organization_id, array['administrator','manager'])
) with check (public.watercare_has_role(organization_id, array['administrator','manager']));

create policy project_tasks_manager_insert on public.project_tasks for insert to authenticated with check (
    public.watercare_has_role(organization_id, array['administrator','manager'])
);
create policy project_tasks_manager_update on public.project_tasks for update to authenticated using (
    public.watercare_has_role(organization_id, array['administrator','manager'])
) with check (public.watercare_has_role(organization_id, array['administrator','manager']));
create policy project_tasks_employee_update on public.project_tasks for update to authenticated using (
    public.watercare_has_role(organization_id, array['employee']) and
    engineer_id = public.watercare_assigned_engineer(organization_id)
) with check (
    public.watercare_has_role(organization_id, array['employee']) and
    engineer_id = public.watercare_assigned_engineer(organization_id)
);

create policy cleaning_manager_insert on public.cleaning_records for insert to authenticated with check (
    public.watercare_has_role(organization_id, array['administrator','manager'])
);
create policy cleaning_manager_update on public.cleaning_records for update to authenticated using (
    public.watercare_has_role(organization_id, array['administrator','manager'])
) with check (public.watercare_has_role(organization_id, array['administrator','manager']));

create policy testing_manager_insert on public.water_testing_records for insert to authenticated with check (
    public.watercare_has_role(organization_id, array['administrator','manager'])
);
create policy testing_manager_update on public.water_testing_records for update to authenticated using (
    public.watercare_has_role(organization_id, array['administrator','manager'])
) with check (public.watercare_has_role(organization_id, array['administrator','manager']));

create policy documents_manager_insert on public.uploaded_documents for insert to authenticated with check (
    public.watercare_has_role(organization_id, array['administrator','manager'])
);
create policy documents_manager_update on public.uploaded_documents for update to authenticated using (
    public.watercare_has_role(organization_id, array['administrator','manager'])
) with check (public.watercare_has_role(organization_id, array['administrator','manager']));

create policy engineers_manager_read on public.engineers for select to authenticated using (
    public.is_watercare_member(organization_id) and public.watercare_has_role(organization_id, array['administrator','manager'])
);
create policy engineers_self_read on public.engineers for select to authenticated using (
    public.is_watercare_member(organization_id) and user_id = auth.uid()
);
create policy projects_org_read on public.projects for select to authenticated using (
    public.is_watercare_member(organization_id) and (
        public.watercare_has_role(organization_id, array['administrator','manager']) or public.watercare_project_assigned(id)
    )
);
create policy project_engineers_manager_read on public.project_engineers for select to authenticated using (
    public.is_watercare_member(organization_id) and public.watercare_has_role(organization_id, array['administrator','manager'])
);
create policy project_engineers_self_read on public.project_engineers for select to authenticated using (
    public.is_watercare_member(organization_id) and engineer_id = public.watercare_assigned_engineer(organization_id)
);
create policy project_tasks_assigned_read on public.project_tasks for select to authenticated using (
    public.is_watercare_member(organization_id) and (
        public.watercare_has_role(organization_id, array['administrator','manager']) or
        public.watercare_project_assigned(project_id) or engineer_id = public.watercare_assigned_engineer(organization_id)
    )
);

create policy cleaning_assigned_read on public.cleaning_records for select to authenticated using (
    public.is_watercare_member(organization_id) and (
        public.watercare_has_role(organization_id, array['administrator','manager']) or engineer_id = public.watercare_assigned_engineer(organization_id)
    )
);

create policy testing_assigned_read on public.water_testing_records for select to authenticated using (
    public.is_watercare_member(organization_id) and (
        public.watercare_has_role(organization_id, array['administrator','manager']) or engineer_id = public.watercare_assigned_engineer(organization_id)
    )
);

create policy documents_org_read on public.uploaded_documents for select to authenticated using (
    public.is_watercare_member(organization_id)
);
create policy notifications_user_scope on public.notifications for all to authenticated using (user_id = auth.uid() and public.is_watercare_member(organization_id)) with check (user_id = auth.uid() and public.is_watercare_member(organization_id));
create policy audit_org_read on public.audit_logs for select to authenticated using (organization_id is not null and public.is_watercare_member(organization_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('watercare-private', 'watercare-private', false, 15728640,
        array['application/pdf','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png'])
on conflict (id) do nothing;
do $$
begin
    if exists (select 1 from storage.buckets where id = 'watercare-private' and public) then
        raise exception 'The watercare-private bucket already exists as a public bucket; make it private before continuing.';
    end if;
end;
$$;

create policy watercare_storage_read on storage.objects for select to authenticated
using (bucket_id = 'watercare-private' and exists (
    select 1 from public.organization_memberships m
    where m.user_id = auth.uid() and m.status = 'active'
      and (storage.foldername(name))[1] = m.organization_id::text
));
create policy watercare_storage_insert on storage.objects for insert to authenticated
with check (bucket_id = 'watercare-private' and exists (
    select 1 from public.organization_memberships m
    where m.user_id = auth.uid() and m.status = 'active' and m.role in ('administrator','manager')
      and (storage.foldername(name))[1] = m.organization_id::text
));
create policy watercare_storage_delete on storage.objects for delete to authenticated
using (bucket_id = 'watercare-private' and exists (
    select 1 from public.organization_memberships m
    where m.user_id = auth.uid() and m.status = 'active' and m.role in ('administrator','manager')
      and (storage.foldername(name))[1] = m.organization_id::text
));
create policy watercare_storage_update on storage.objects for update to authenticated
using (bucket_id = 'watercare-private' and exists (
    select 1 from public.organization_memberships m
    where m.user_id = auth.uid() and m.status = 'active' and m.role in ('administrator','manager')
      and (storage.foldername(name))[1] = m.organization_id::text
))
with check (bucket_id = 'watercare-private' and exists (
    select 1 from public.organization_memberships m
    where m.user_id = auth.uid() and m.status = 'active' and m.role in ('administrator','manager')
      and (storage.foldername(name))[1] = m.organization_id::text
));

grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to service_role;
revoke update on public.project_tasks from authenticated;
grant update (status, notes) on public.project_tasks to authenticated;
