drop policy if exists service_images_client_avatar_insert on storage.objects;
drop policy if exists service_images_client_avatar_select on storage.objects;
drop policy if exists service_images_client_avatar_update on storage.objects;

create policy service_images_client_avatar_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'service-images'
  and (storage.foldername(storage.objects.name))[1] = 'avatars'
  and exists (
    select 1
    from public.users u
    where u.id::text = (storage.foldername(storage.objects.name))[2]
      and u.auth_user_id = auth.uid()
      and u.role = 'client'
  )
);

create policy service_images_client_avatar_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'service-images'
  and (storage.foldername(storage.objects.name))[1] = 'avatars'
  and exists (
    select 1
    from public.users u
    where u.id::text = (storage.foldername(storage.objects.name))[2]
      and u.auth_user_id = auth.uid()
      and u.role = 'client'
  )
);

create policy service_images_client_avatar_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'service-images'
  and (storage.foldername(storage.objects.name))[1] = 'avatars'
  and exists (
    select 1
    from public.users u
    where u.id::text = (storage.foldername(storage.objects.name))[2]
      and u.auth_user_id = auth.uid()
      and u.role = 'client'
  )
)
with check (
  bucket_id = 'service-images'
  and (storage.foldername(storage.objects.name))[1] = 'avatars'
  and exists (
    select 1
    from public.users u
    where u.id::text = (storage.foldername(storage.objects.name))[2]
      and u.auth_user_id = auth.uid()
      and u.role = 'client'
  )
);
