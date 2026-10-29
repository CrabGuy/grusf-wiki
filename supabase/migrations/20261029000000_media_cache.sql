-- Web-size copies of large images live in cache/media/<same path as media/>.webp.
-- Members may add them when they upload an image (reading is already allowed by "members read wiki files").
create policy "members add image copies"
	on storage.objects for insert to authenticated
	with check (
		bucket_id = 'wiki'
		and (storage.foldername(name))[1] = 'cache'
		and (storage.foldername(name))[2] = 'media'
		and name like '%.webp'
	);
