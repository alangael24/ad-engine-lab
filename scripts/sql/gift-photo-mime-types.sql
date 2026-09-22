-- Guest reference uploads use studio-media. Keep the bucket private and preserve
-- all existing media formats; application endpoints still enforce photo limits.
update storage.buckets
set allowed_mime_types = array(
 select distinct mime from unnest(allowed_mime_types || array['image/png','image/jpeg','image/webp']) mime order by mime
)
where id='studio-media' and allowed_mime_types is not null;
