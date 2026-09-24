-- =============================================================
-- Regression from 20260917030000 (HIGH-03 fix): that migration
-- correctly stopped pending/rejected users from bulk-reading every
-- profile row, by requiring get_auth_role() IS NOT NULL (i.e.
-- approved) on the profiles SELECT policy. But it removed ALL
-- self-read access for a pending/rejected account too - including
-- their own row - since get_auth_role() is NULL for them.
--
-- AuthContext.fetchProfile does `.single()` on the caller's own
-- profile right after a successful Supabase Auth sign-in. For a
-- pending/rejected account, that query now returns 0 rows (RLS
-- filters it out), `.single()` throws, and `profile` stays null
-- forever. Login.tsx's redirect effect only fires once BOTH
-- `session` and `profile` are set, so it never fires - the user is
-- stuck on an infinite "Authenticating..." spinner with no
-- feedback at all. The "Account Pending"/"Account Rejected" screens
-- in AuthGuard.tsx are unreachable via the normal login flow,
-- because nothing ever navigates the user to a route AuthGuard
-- protects.
--
-- Confirmed live with disposable pending and rejected test
-- accounts: both hang on "Authenticating..." indefinitely; the
-- browser console shows PGRST116 "Cannot coerce the result to a
-- single JSON object" from the 0-row profiles query.
--
-- Fix: let a user always read their own profile row regardless of
-- status, in addition to the existing approved-only bulk-read. This
-- doesn't reopen HIGH-03 - the added clause only ever matches the
-- caller's own id, never another user's row.
-- =============================================================

drop policy if exists "Approved users can read profiles" on public.profiles;
create policy "Approved users can read profiles"
  on public.profiles
  for select
  using (get_auth_role() is not null or id = auth.uid());
