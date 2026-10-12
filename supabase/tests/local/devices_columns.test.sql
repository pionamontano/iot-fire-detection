-- DB-001: admin reads of public.devices under the column-level grants from 20261015. Local harness only.
-- The explicit list below MUST equal DEVICE_COLUMNS in src/lib/deviceColumns.ts.
create or replace function pg_temp.check(name text, ok boolean) returns void language plpgsql as $$
begin raise notice '%: %', case when ok then 'PASS' else 'FAIL' end, name; end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false), set_config('request.jwt.claim.role','authenticated',false);

-- granted columns for 'authenticated' (read from the catalog, not assumed)
do $$ declare cols text[]; begin
  select array_agg(column_name::text order by column_name) into cols
  from information_schema.column_privileges
  where table_schema='public' and table_name='devices' and grantee='authenticated' and privilege_type='SELECT';
  perform pg_temp.check('granted SELECT columns match DEVICE_COLUMNS ('||array_to_string(cols,',')||')',
    cols = (select array_agg(c order by c) from unnest(string_to_array(
      'id,device_code,label,location_desc,co_threshold,temp_threshold,bfp_contact,is_active,created_at,last_seen_at,latitude,longitude,local_ip', ',')) c));
end $$;

set role authenticated;
do $$ declare n int; begin
  begin perform * from devices; perform pg_temp.check('admin select * on devices is rejected (the DB-001 failure mode)', false);
  exception when insufficient_privilege then perform pg_temp.check('admin select * on devices is rejected (the DB-001 failure mode)', true); end;

  select count(*) into n from (select id,device_code,label,location_desc,co_threshold,temp_threshold,bfp_contact,is_active,created_at,last_seen_at,latitude,longitude,local_ip from devices) s;
  perform pg_temp.check('admin explicit-column select works (rows='||n||')', n=2);

  begin perform api_key from devices; perform pg_temp.check('api_key is not selectable by authenticated', false);
  exception when insufficient_privilege then perform pg_temp.check('api_key is not selectable by authenticated', true); end;

  -- embedded form used by Dashboard: alert_events -> devices(*) is equivalent to a join selecting d.*
  begin perform d.* from alert_events a join devices d on d.id=a.device_id; perform pg_temp.check('join selecting d.* is rejected too', false);
  exception when insufficient_privilege then perform pg_temp.check('join selecting d.* is rejected too', true); end;
end $$;
reset role;
