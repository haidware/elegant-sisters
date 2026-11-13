create extension if not exists pgcrypto;

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

alter table public.groups enable row level security;
alter table public.members enable row level security;
alter table public.member_photos enable row level security;

grant select on public.groups, public.members, public.member_photos to anon, authenticated;
revoke insert, update, delete on public.groups, public.members, public.member_photos from anon, authenticated;

drop policy if exists "Public can view published groups" on public.groups;
create policy "Public can view published groups"
  on public.groups for select to anon, authenticated
  using (published);

drop policy if exists "Admins can manage groups" on public.groups;

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
  );

drop policy if exists "Admins can manage members" on public.members;

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
  );

drop policy if exists "Admins can manage member photos" on public.member_photos;

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
drop policy if exists "Admins can update member photos" on storage.objects;
drop policy if exists "Admins can delete member photos" on storage.objects;

drop function if exists public.is_admin();
drop table if exists public.admin_users;

