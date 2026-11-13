create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  sort_order integer not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  full_name text not null,
  slug text not null,
  role_title text not null default 'Sister',
  bio text,
  sort_order integer not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, slug)
);

create table if not exists public.member_photos (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  image_url text not null,
  storage_path text not null unique,
  caption text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists members_published_order_idx
  on public.members (group_id, published, sort_order);
create index if not exists member_photos_member_order_idx
  on public.member_photos (member_id, sort_order);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

alter table public.admin_users enable row level security;
alter table public.groups enable row level security;
alter table public.members enable row level security;
alter table public.member_photos enable row level security;

grant select on public.groups, public.members, public.member_photos to anon, authenticated;
grant insert, update, delete on public.groups, public.members, public.member_photos to authenticated;
grant select on public.admin_users to authenticated;

drop policy if exists "Admins can read their own access" on public.admin_users;
create policy "Admins can read their own access"
  on public.admin_users for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Public can view published groups" on public.groups;
create policy "Public can view published groups"
  on public.groups for select to anon, authenticated
  using (published or (select public.is_admin()));

drop policy if exists "Admins can manage groups" on public.groups;
create policy "Admins can manage groups"
  on public.groups for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Public can view published members" on public.members;
create policy "Public can view published members"
  on public.members for select to anon, authenticated
  using (
    (
      published
      and exists (
        select 1
        from public.groups
        where groups.id = members.group_id
          and groups.published
      )
    )
    or (select public.is_admin())
  );

drop policy if exists "Admins can manage members" on public.members;
create policy "Admins can manage members"
  on public.members for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Public can view photos of published members" on public.member_photos;
create policy "Public can view photos of published members"
  on public.member_photos for select to anon, authenticated
  using (
    exists (
      select 1
      from public.members
      where members.id = member_photos.member_id
        and members.published
        and exists (
          select 1
          from public.groups
          where groups.id = members.group_id
            and groups.published
        )
    )
    or (select public.is_admin())
  );

drop policy if exists "Admins can manage member photos" on public.member_photos;
create policy "Admins can manage member photos"
  on public.member_photos for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'member-photos',
  'member-photos',
  true,
  52428800,
  null
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = null;

drop policy if exists "Anyone can view member photos" on storage.objects;
create policy "Anyone can view member photos"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'member-photos');

drop policy if exists "Admins can upload member photos" on storage.objects;
create policy "Admins can upload member photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'member-photos'
    and metadata ->> 'mimetype' like 'image/%'
    and (select public.is_admin())
  );

drop policy if exists "Admins can update member photos" on storage.objects;
create policy "Admins can update member photos"
  on storage.objects for update to authenticated
  using (bucket_id = 'member-photos' and (select public.is_admin()))
  with check (
    bucket_id = 'member-photos'
    and metadata ->> 'mimetype' like 'image/%'
    and (select public.is_admin())
  );

drop policy if exists "Admins can delete member photos" on storage.objects;
create policy "Admins can delete member photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'member-photos' and (select public.is_admin()));

insert into public.admin_users (user_id)
values ('436c0916-231d-4c13-a8bc-5eec89ae88ee')
on conflict (user_id) do nothing;
