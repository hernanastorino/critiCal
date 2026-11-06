-- «Revocar todo y borrar la cuenta». The server first revokes Google's grant (and, if
-- asked, deletes the Plan calendar), then calls one of these.

/**
 * Forgets every stored secret of a user (Google and iCloud credentials, the Gemini key),
 * the widget token and the imported calendars. Planning keeps working with what is left,
 * until they connect again.
 */
create function public.revoke_connections(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets
  where id in (select secret_id from private.oauth_tokens where user_id = p_user);
  delete from private.oauth_tokens where user_id = p_user;
  delete from public.google_channels where user_id = p_user;
  delete from private.widget_tokens where user_id = p_user;
  -- Imported events would go stale without their connection.
  delete from public.calendar_events where user_id = p_user;
  delete from public.calendars where user_id = p_user;
  update public.settings set google_plan_calendar = null where user_id = p_user;
end $$;

/**
 * Deletes a user and everything of theirs: the vault secrets (which do not cascade),
 * their invitation, and the account, whose rows cascade from auth.users. The owner
 * cannot: the app would be left without anyone to manage the invitations.
 */
create function public.delete_account(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from private.app_config where key = 'owner' and value = p_user::text) then
    raise exception 'owner_cannot_delete';
  end if;
  perform public.revoke_connections(p_user);
  delete from public.invites
  where email in (
    select lower(btrim(identity_data ->> 'email')) from auth.identities
    where user_id = p_user and provider = 'google'
  );
  delete from auth.users where id = p_user;
end $$;

revoke execute on function public.revoke_connections(uuid) from public, anon, authenticated;
revoke execute on function public.delete_account(uuid) from public, anon, authenticated;
grant execute on function public.revoke_connections(uuid) to service_role;
grant execute on function public.delete_account(uuid) to service_role;
