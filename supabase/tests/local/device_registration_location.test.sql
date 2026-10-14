-- register_device() / update_own_device_location() / location_verified trigger (20261102000000). Local harness only.
create or replace function pg_temp.check(name text, ok boolean) returns void language plpgsql as $$
begin raise notice '%: %', case when ok then 'PASS' else 'FAIL' end, name; end $$;
create or replace function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', uid, false), set_config('request.jwt.claim.role', 'authenticated', false) $$;
-- No auth.uid(): service role / SQL editor / seed scripts.
create or replace function pg_temp.as_backend() returns void language sql as $$
  select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'service_role', false) $$;

-- Fixture devices T-001/T-002 have no pin, so the backfill left them unverified.
do $$ begin
  perform pg_temp.check('fixture device without a pin is unverified',
    not (select location_verified from devices where device_code = 'T-001'));
end $$;

-- ── register_device ──────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
do $$ declare r json; r2 json; begin
  r := register_device('  Kitchen unit  ');
  perform pg_temp.check('admin gets a generated AGS code ('||(r->>'device_code')||')', (r->>'device_code') ~ '^AGS-\d{3,}$');
  perform pg_temp.check('admin gets the API key back once', (r->>'api_key') like 'sk_%');
  perform pg_temp.check('label is trimmed', (select label from devices where id = (r->>'id')::uuid) = 'Kitchen unit');
  perform pg_temp.check('thresholds use column defaults',
    (select temp_threshold = 60 and co_threshold = 200 from devices where id = (r->>'id')::uuid));
  perform pg_temp.check('new device has no address or pin and is unverified',
    (select location_desc is null and latitude is null and not location_verified from devices where id = (r->>'id')::uuid));

  r2 := register_device(null);
  perform pg_temp.check('codes are sequential', (r2->>'device_code') > (r->>'device_code'));
  perform pg_temp.check('blank name falls back to the code',
    (select label from devices where id = (r2->>'id')::uuid) = r2->>'device_code');
end $$;
reset role;

-- A hand-created code in the sequence's path is skipped, not duplicated.
insert into devices(device_code, label) values ('AGS-' || lpad((select last_value + 1 from device_code_seq)::text, 3, '0'), 'manual');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
do $$ declare r json; begin
  r := register_device('after manual');
  perform pg_temp.check('a manually used code is skipped', (select count(*) from devices where device_code = r->>'device_code') = 1);
end $$;
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
do $$ begin
  begin perform register_device('x'); perform pg_temp.check('resident cannot register a device', false);
  exception when others then perform pg_temp.check('resident cannot register a device', true); end;
end $$;
reset role;

-- ── Resident sets the pin -> unverified ──────────────────────────
select pg_temp.as_backend();
update devices set latitude = 14.84, longitude = 120.81, location_desc = 'Admin set', location_verified = true
where device_code = 'T-001';
do $$ begin
  perform pg_temp.check('backend context may mark a pin verified',
    (select location_verified and location_verified_at is not null from devices where device_code = 'T-001'));
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
do $$ declare r json; begin
  r := update_own_device_location('  12 Rizal St, Malolos  ', 14.85, 120.82);
  perform pg_temp.check('resident RPC returns unverified', (r->>'location_verified')::boolean = false);
  perform pg_temp.check('resident RPC trims the address', r->>'location_desc' = '12 Rizal St, Malolos');

  begin perform update_own_device_location('x', 0, 0); perform pg_temp.check('(0,0) pin is rejected', false);
  exception when others then perform pg_temp.check('(0,0) pin is rejected', true); end;
  begin perform update_own_device_location('x', 91, 120); perform pg_temp.check('out-of-range pin is rejected', false);
  exception when others then perform pg_temp.check('out-of-range pin is rejected', true); end;
  begin perform update_own_device_location('   ', 14.8, 120.8); perform pg_temp.check('empty address is rejected', false);
  exception when others then perform pg_temp.check('empty address is rejected', true); end;
end $$;
reset role;
do $$ begin
  perform pg_temp.check('resident change cleared verified_at/by',
    (select not location_verified and location_verified_at is null and location_verified_by is null
       and latitude = 14.85 from devices where device_code = 'T-001'));
  perform pg_temp.check('other resident''s device untouched',
    (select location_desc = 'Loc 2' from devices where device_code = 'T-002'));
end $$;

-- The older address-only RPC also withdraws a confirmation.
select pg_temp.as_backend();
update devices set location_verified = true where device_code = 'T-001';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select update_own_device_location_desc('12 Rizal St, Unit 3, Malolos');
reset role;
do $$ begin
  perform pg_temp.check('address-only edit by resident resets verification',
    not (select location_verified from devices where device_code = 'T-001'));
end $$;

-- ── Admin confirms ───────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
update devices set location_verified = true where device_code = 'T-001';
reset role;
do $$ begin
  perform pg_temp.check('admin confirmation stamps by/at',
    (select location_verified and location_verified_by = '00000000-0000-0000-0000-0000000000a1'
       and location_verified_at is not null from devices where device_code = 'T-001'));
end $$;

-- An unrelated admin edit keeps the confirmation.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
update devices set temp_threshold = 70 where device_code = 'T-001';
reset role;
do $$ begin
  perform pg_temp.check('threshold edit keeps confirmation',
    (select location_verified from devices where device_code = 'T-001'));
end $$;

-- ── Grants / view ────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
do $$ begin
  perform pg_temp.check('resident sees location_verified through devices_safe',
    (select location_verified from devices_safe where device_code = 'T-001'));
  begin perform location_verified_by from devices; perform pg_temp.check('location_verified_by is not selectable', false);
  exception when insufficient_privilege then perform pg_temp.check('location_verified_by is not selectable', true); end;
end $$;
reset role;
