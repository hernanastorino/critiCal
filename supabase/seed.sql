-- Local development only (`supabase db reset`): the test account of SPEC §17.
-- Invented email and password, also in .env.example; never use them anywhere else.
-- Being the first account, it owns the app (invitations), like the real owner does.
do $$
declare
  uid uuid := '00000000-0000-4000-8000-00000000c41a';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    'prueba@critical.test', extensions.crypt('prueba-critical-local', extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  );
  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), uid, uid::text,
    jsonb_build_object('sub', uid::text, 'email', 'prueba@critical.test', 'email_verified', true),
    'email', now(), now(), now()
  );
  -- A Google grant that no longer works: the first sync shows «Reconectar Google»,
  -- which with the invented providers (VITE_FAKE_PROVIDERS=1) stores one that does.
  perform public.store_oauth_token(uid, 'google', 'fake-google-revoked');
end $$;
