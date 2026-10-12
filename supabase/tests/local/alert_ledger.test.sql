-- Step 5.1a: notification ledger. Local harness only. AT-LEAST-ONCE semantics are tested explicitly.
create or replace function pg_temp.check(name text, ok boolean) returns void language plpgsql as $$
begin raise notice '%: %', case when ok then 'PASS' else 'FAIL' end, name; end $$;
create or replace function pg_temp.fails_with(sql text, state text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlstate = state; end $$;

insert into alert_events(id, device_id, alert_tier, co_ppm, temp_celsius)
values ('b0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 2, 300, 80);
\set a '''b0000000-0000-0000-0000-000000000001'''

select pg_temp.check('first claim for a key succeeds', claim_notification(:a, 2, 'push', 'u1'));
select pg_temp.check('a second concurrent/replayed claim is refused', not claim_notification(:a, 2, 'push', 'u1'));
select pg_temp.check('different channel, tier or recipient are independent keys',
  claim_notification(:a, 2, 'telegram_user', 'u1') and claim_notification(:a, 1, 'push', 'u1') and claim_notification(:a, 2, 'push', 'u2'));

-- terminal states
select complete_notification(:a, 2, 'push', 'u1', 'sent', '201', 'ref-1', null);
select pg_temp.check('SENT is terminal: never re-claimed', not claim_notification(:a, 2, 'push', 'u1'));
select pg_temp.check('sent row records provider status and reference',
  (select provider_status = '201' and provider_ref = 'ref-1' and status = 'sent' from alert_notifications where recipient_key = 'u1' and channel = 'push' and tier = 2));
select complete_notification(:a, 2, 'push', 'u2', 'skipped', null, null, 'no push subscription');
select pg_temp.check('SKIPPED is terminal: never re-claimed', not claim_notification(:a, 2, 'push', 'u2'));

-- failure + retry budget
select claim_notification(:a, 2, 'telegram_station', 'station');
select complete_notification(:a, 2, 'telegram_station', 'station', 'failed', '500', null, 'boom');
select pg_temp.check('FAILED (retryable) can be claimed again - attempt 2', claim_notification(:a, 2, 'telegram_station', 'station'));
select complete_notification(:a, 2, 'telegram_station', 'station', 'failed', '500', null, 'boom');
select pg_temp.check('...attempt 3', claim_notification(:a, 2, 'telegram_station', 'station'));
select complete_notification(:a, 2, 'telegram_station', 'station', 'failed', '500', null, 'boom');
select pg_temp.check('...and stops once max attempts (3) is reached', not claim_notification(:a, 2, 'telegram_station', 'station'));
select pg_temp.check('attempt counter reflects the retries', (select attempts = 3 from alert_notifications where channel = 'telegram_station'));
select claim_notification(:a, 2, 'telegram_user', 'cust');
select complete_notification(:a, 2, 'telegram_user', 'cust', 'failed', '500', null, 'x');
select pg_temp.check('a custom max-attempts is honoured (limit 1 refuses a retry after 1 attempt)', not claim_notification(:a, 2, 'telegram_user', 'cust', 1));
select pg_temp.check('...while the default budget would still allow it', claim_notification(:a, 2, 'telegram_user', 'cust'));

-- permanent errors are not retried
select claim_notification(:a, 2, 'telegram_user', 'blocked');
select complete_notification(:a, 2, 'telegram_user', 'blocked', 'failed', '403', null, 'bot was blocked by the user', false);
select pg_temp.check('NON-retryable failure (bot blocked) is never re-claimed', not claim_notification(:a, 2, 'telegram_user', 'blocked'));

-- AT-LEAST-ONCE: the provider may have accepted the message while the sender died before recording it
select claim_notification(:a, 2, 'push', 'crashy');
select pg_temp.check('a FRESH pending claim is not stolen by a concurrent caller', not claim_notification(:a, 2, 'push', 'crashy'));
update alert_notifications set claimed_at = now() - interval '5 minutes' where recipient_key = 'crashy';
select pg_temp.check('AT-LEAST-ONCE: a STALE pending claim (sender crashed/timed out, provider outcome unknown) is reclaimed => a duplicate is possible by design',
  claim_notification(:a, 2, 'push', 'crashy'));
select pg_temp.check('...and is counted as attempt 2', (select attempts = 2 from alert_notifications where recipient_key = 'crashy'));

-- validation / constraints / privileges
select pg_temp.check('invalid completion status rejected (22023)', pg_temp.fails_with($q$select complete_notification('b0000000-0000-0000-0000-000000000001', 2, 'push', 'u1', 'delivered')$q$, '22023'));
select pg_temp.check('tier 3 rejected by CHECK (23514)', pg_temp.fails_with($q$select claim_notification('b0000000-0000-0000-0000-000000000001', 3, 'push', 'x')$q$, '23514'));
select pg_temp.check('unknown channel rejected by CHECK (23514)', pg_temp.fails_with($q$select claim_notification('b0000000-0000-0000-0000-000000000001', 2, 'sms', 'x')$q$, '23514'));
select pg_temp.check('unknown alert id rejected by FK (23503)', pg_temp.fails_with($q$select claim_notification('b0000000-0000-0000-0000-0000000000ff', 2, 'push', 'x')$q$, '23503'));
select pg_temp.check('service_role can execute claim/complete',
  has_function_privilege('service_role', 'public.claim_notification(uuid,integer,text,text,integer,interval)', 'execute')
  and has_function_privilege('service_role', 'public.complete_notification(uuid,integer,text,text,text,text,text,text,boolean)', 'execute'));
select pg_temp.check('anon/authenticated cannot execute claim_notification',
  not has_function_privilege('anon', 'public.claim_notification(uuid,integer,text,text,integer,interval)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_notification(uuid,integer,text,text,integer,interval)', 'execute'));
select pg_temp.check('anon/authenticated cannot execute complete_notification',
  not has_function_privilege('anon', 'public.complete_notification(uuid,integer,text,text,text,text,text,text,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.complete_notification(uuid,integer,text,text,text,text,text,text,boolean)', 'execute'));
select pg_temp.check('anon/authenticated have NO privileges on alert_notifications',
  not has_table_privilege('anon', 'public.alert_notifications', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.alert_notifications', 'select,insert,update,delete'));
select pg_temp.check('RLS is enabled on alert_notifications', (select relrowsecurity from pg_class where oid = 'public.alert_notifications'::regclass));
select pg_temp.check('security definer functions pin search_path',
  (select count(*) = 2 from pg_proc where proname in ('claim_notification', 'complete_notification') and prosecdef and proconfig::text like '%search_path=public, pg_temp%'));

-- ledger rows go away with their incident (no orphan delivery state)
delete from alert_events where id = :a;
select pg_temp.check('ledger rows cascade-delete with the incident', (select count(*) = 0 from alert_notifications));
