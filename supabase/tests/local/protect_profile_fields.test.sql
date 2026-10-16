-- protect_profile_fields() after 20261108000000 (KI-10). Each check prints PASS/FAIL.
-- Local harness only; every block rolls back.
create or replace function pg_temp.check(name text, ok boolean) returns void language plpgsql as $$
begin raise notice '%: %', case when ok then 'PASS' else 'FAIL' end, name; end $$;

-- The KI-10 reproduction: a deactivated resident with a still-valid token re-activates itself.
begin;
  update profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000b1';
  set local role authenticated;
  select set_config('request.jwt.claim.role', 'authenticated', true);
  select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
  update profiles set is_active = true where id = auth.uid();
  do $$ begin
    perform pg_temp.check('deactivated resident cannot set its own is_active back to true',
      (select not is_active from profiles where id = auth.uid()));
    perform pg_temp.check('...and get_auth_role() stays null', get_auth_role() is null);
  end $$;
rollback;

-- A deactivated ADMIN is no longer exempt from the guard.
begin;
  update profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000a1';
  set local role authenticated;
  select set_config('request.jwt.claim.role', 'authenticated', true);
  select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
  update profiles set is_active = true where id = auth.uid();
  do $$ begin
    perform pg_temp.check('deactivated admin cannot re-activate itself',
      (select not is_active from profiles where id = auth.uid()));
  end $$;
rollback;

-- An active user cannot deactivate or escalate itself either; ordinary fields still save.
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.role', 'authenticated', true);
  select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
  update profiles set is_active = false, role = 'admin', status = 'approved',
                      full_name = 'Renamed', setup_complete = true
   where id = auth.uid();
  do $$ declare r record; begin
    select * into r from profiles where id = auth.uid();
    perform pg_temp.check('active responder: is_active unchanged', r.is_active);
    perform pg_temp.check('active responder: role unchanged', r.role = 'bfp_responder');
    perform pg_temp.check('active responder: full_name saved', r.full_name = 'Renamed');
    perform pg_temp.check('active responder: setup_complete still user-writable (ResidentSetup)', r.setup_complete);
  end $$;
rollback;

-- An approved, active admin is still exempt (parity with telegram_chat_id.test.sql). Admins change
-- OTHER users through manage-user (service role, below): no RLS policy lets them update other rows directly.
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.role', 'authenticated', true);
  select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
  update profiles set telegram_chat_id = '424242' where id = auth.uid();
  do $$ begin
    perform pg_temp.check('approved admin can still set a protected column on its own row',
      (select telegram_chat_id = '424242' from profiles where id = auth.uid()));
  end $$;
rollback;

-- Sessions that never switch role (SQL editor / migrations) and the service role keep bypassing the guard.
begin;
  update profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000b1';
  do $$ begin
    perform pg_temp.check('SQL-editor-style session can change is_active',
      (select not is_active from profiles where id = '00000000-0000-0000-0000-0000000000b1'));
  end $$;
rollback;
begin;
  set local role service_role;
  update profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000b1';
  do $$ begin
    perform pg_temp.check('service_role (manage-user) can change is_active',
      (select not is_active from profiles where id = '00000000-0000-0000-0000-0000000000b1'));
  end $$;
rollback;

select pg_temp.check('trigger function pins search_path',
  (select proconfig::text like '%search_path=public, pg_temp%' from pg_proc where proname = 'protect_profile_fields'));
