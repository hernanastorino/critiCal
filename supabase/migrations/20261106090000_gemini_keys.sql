-- Each user may bring their own Gemini (Google AI Studio) key. It is kept in the vault
-- like the calendar tokens (provider 'gemini') and never goes back to the browser.
-- A key alone is not a calendar connection: background sync ignores it.
create or replace function public.connected_users()
returns setof uuid language sql security definer stable set search_path = '' as $$
  select distinct user_id from private.oauth_tokens
  where provider <> 'gemini' and private.invited(user_id);
$$;
