grant usage on schema app_private to authenticated;

drop policy if exists service_images_admin_insert on storage.objects;
drop policy if exists service_images_admin_update on storage.objects;
drop policy if exists service_images_admin_delete on storage.objects;

create policy service_images_admin_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'service-images'
  and app_private.is_admin()
);

create policy service_images_admin_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'service-images'
  and app_private.is_admin()
)
with check (
  bucket_id = 'service-images'
  and app_private.is_admin()
);

create policy service_images_admin_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'service-images'
  and app_private.is_admin()
);
