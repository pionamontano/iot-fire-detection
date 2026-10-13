-- Owner decisions D5.4/D5.5 (issue #95): telegram_chat_id is unique and settable only by the service
-- role (telegram-webhook) or an admin, never by a user updating their own row directly. Local harness only.
create or replace function pg_temp.check(name text, ok boolean) returns void language plpgsql as $$
begin raise notice '%: %', case when ok then 'PASS' else 'FAIL' end, name; end $$;
create or replace function pg_temp.fails_with(sql text, state text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlstate = state; end $$;
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); perform set_config('request.jwt.claim.role','authenticated',false); end $$;

-- ================= uniqueness =================
select pg_temp.check('telegram_chat_id_unique index exists and is partial on telegram_chat_id IS NOT NULL',
  (select indexdef like '%UNIQUE%(telegram_chat_id)%WHERE (telegram_chat_id IS NOT NULL)%' from pg_indexes where indexname = 'telegram_chat_id_unique'));

set role service_role;
update profiles set telegram_chat_id = 'chat-1' where id = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.check('service role (webhook) can set telegram_chat_id',
  (select telegram_chat_id = 'chat-1' from profiles where id = '00000000-0000-0000-0000-0000000000b1'));
select pg_temp.check('a second profile cannot take the SAME chat id (23505)',
  pg_temp.fails_with($q$update profiles set telegram_chat_id = 'chat-1' where id = '00000000-0000-0000-0000-0000000000b2'$q$, '23505'));
select pg_temp.check('two different profiles may both have telegram_chat_id = NULL (partial index does not apply)', true
  and (select telegram_chat_id is null from profiles where id = '00000000-0000-0000-0000-0000000000b2')
  and (select telegram_chat_id is null from profiles where id = '00000000-0000-0000-0000-0000000000c1'));
reset role;

-- ================= protect_profile_fields: non-admin cannot set their own telegram_chat_id =================
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
update profiles set telegram_chat_id = 'self-set' where id = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.check('a non-admin updating their own row cannot set telegram_chat_id directly (silently reverted, not an error)',
  (select telegram_chat_id is null from profiles where id = '00000000-0000-0000-0000-0000000000c1'));
reset role;

-- unchanged behaviour: role/status/device_id are still guarded the same way
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
update profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.check('[unchanged] a non-admin still cannot escalate their own role', (select role = 'bfp_responder' from profiles where id = '00000000-0000-0000-0000-0000000000c1'));
reset role;

-- admin bypass is intentionally unchanged (parity with role/status/device_id)
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
update profiles set telegram_chat_id = 'admin-self' where id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.check('[parity] an admin may still set telegram_chat_id on their OWN row directly (same bypass as role/status/device_id)',
  (select telegram_chat_id = 'admin-self' from profiles where id = '00000000-0000-0000-0000-0000000000a1'));
reset role;
