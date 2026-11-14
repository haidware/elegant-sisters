create extension if not exists pgcrypto;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  member_count integer not null default 1 constraint groups_member_count_positive check (member_count > 0),
  sort_order integer not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  full_name text not null,
  slug text not null,
  role_title text not null default 'Member',
  bio text,
  portrait_url text,
  portrait_storage_path text,
  media_ready boolean not null default true,
  sort_order integer not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, slug)
);

alter table public.members alter column role_title set default 'Member';

alter table public.groups add column if not exists member_count integer;
update public.groups g
set member_count = greatest(
  (select count(*)::integer from public.members m where m.group_id = g.id),
  1
)
where member_count is null;
alter table public.groups alter column member_count set default 1;
alter table public.groups alter column member_count set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'groups_member_count_positive'
      and conrelid = 'public.groups'::regclass
  ) then
    alter table public.groups
      add constraint groups_member_count_positive check (member_count > 0);
  end if;
end
$$;

create table if not exists public.member_photos (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  image_url text not null,
  storage_path text not null unique,
  caption text,
  sort_order integer not null default 0,
  media_type text not null default 'image',
  duration_seconds numeric(6,3),
  created_at timestamptz not null default now()
);

alter table public.members add column if not exists portrait_url text;
alter table public.members add column if not exists portrait_storage_path text;
alter table public.members add column if not exists media_ready boolean not null default true;
alter table public.member_photos add column if not exists media_type text not null default 'image';
alter table public.member_photos add column if not exists duration_seconds numeric(6,3);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'member_photos_media_metadata_check'
      and conrelid = 'public.member_photos'::regclass
  ) then
    alter table public.member_photos
      add constraint member_photos_media_metadata_check
      check (
        (media_type = 'image' and duration_seconds is null)
        or (media_type = 'video' and duration_seconds is not null and duration_seconds > 0 and duration_seconds <= 180)
      );
  end if;
end
$$;

create index if not exists members_published_order_idx
  on public.members (group_id, published, sort_order);
create index if not exists member_photos_member_order_idx
  on public.member_photos (member_id, sort_order);
create unique index if not exists members_portrait_storage_path_idx
  on public.members (portrait_storage_path)
  where portrait_storage_path is not null;
create unique index if not exists member_photos_one_video_per_member_idx
  on public.member_photos (member_id)
  where media_type = 'video';

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

