-- RBAC v2: atomic role rename.
-- The PATCH /config/roles/:id handler previously renamed the roles row, then
-- cascaded the new name to role_tool_visibility and staff in three separate
-- unchecked writes — a partial failure could strand assigned staff on the old
-- name while the endpoint still returned 200. This function does all three in
-- one transaction so they succeed or fail together.

create or replace function rename_role(p_id uuid, p_new_name text)
returns table (id uuid, name text, base_tier text, is_builtin boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
  v_builtin boolean;
begin
  select roles.name, roles.is_builtin into v_old, v_builtin
  from roles where roles.id = p_id;

  if v_old is null then
    raise exception 'Role not found' using errcode = 'no_data_found';
  end if;
  if v_builtin then
    raise exception 'Built-in roles cannot be renamed' using errcode = 'check_violation';
  end if;

  update roles set name = p_new_name, updated_at = now() where roles.id = p_id;
  update role_tool_visibility set role = p_new_name where role = v_old;
  update staff set role = p_new_name where role = v_old;

  return query
    select roles.id, roles.name, roles.base_tier, roles.is_builtin
    from roles where roles.id = p_id;
end;
$$;
