-- =============================================================
-- SW-2.6.3 gap: devices.api_key is only ever set once, via the
-- column's own DEFAULT ('sk_' || encode(gen_random_bytes(24), 'hex'),
-- added in 20260917050000) at INSERT time. There is no way to
-- generate a fresh key for an already-registered device - the admin
-- UI can only set other columns via plain UPDATE.
--
-- A plain client-side UPDATE can't regenerate this safely: the same
-- reasoning as 20260917050000 applies (a real key needs a CSPRNG,
-- which must run in Postgres via pgcrypto, not the browser). This is
-- a narrow SECURITY DEFINER function that only ever touches api_key,
-- checks admin role explicitly (defense in depth alongside the
-- existing "Admin full access on devices" RLS policy), and returns
-- the new key so the admin UI can show/copy it once.
-- =============================================================

create or replace function public.regenerate_device_api_key(p_device_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_key text;
begin
  if public.get_auth_role() <> 'admin' then
    raise exception 'Only an admin can regenerate a device API key';
  end if;

  v_new_key := 'sk_' || encode(gen_random_bytes(24), 'hex');

  update devices
  set api_key = v_new_key
  where id = p_device_id;

  if not found then
    raise exception 'Device not found';
  end if;

  return v_new_key;
end;
$$;

grant execute on function public.regenerate_device_api_key(uuid) to authenticated;
