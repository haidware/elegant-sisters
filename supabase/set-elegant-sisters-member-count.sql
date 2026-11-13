do $$
declare
  target_group_id uuid;
begin
  select id
  into target_group_id
  from public.groups
  where slug = 'new-era-elegant-sisters-international';

  if target_group_id is null then
    raise exception 'New Era Elegant Sisters International group was not found.';
  end if;

  if (
    select count(*)
    from public.members
    where group_id = target_group_id
  ) > 35 or exists (
    select 1
    from public.members
    where group_id = target_group_id
      and sort_order >= 35
  ) then
    raise exception 'The group already has members beyond the planned 35 positions.';
  end if;

  update public.groups
  set member_count = 35
  where id = target_group_id;
end
$$;
