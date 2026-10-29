import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BUCKET, THUMB_MAX, listAll, thumbPath, wantsThumb } from '../supabase/functions/_shared/wiki-core.ts';

/**
 * Create the web-size copy (cache/media/....webp) of every large image in media/ that doesn't
 * have one yet. Originals are only read. With `force`, existing copies are made again.
 */
export async function generateThumbs(sb: SupabaseClient, { force = false, log = console.log } = {}) {
	const existing = new Set((await listAll(sb, 'cache/media')).map((f) => f.name));
	const media = await listAll(sb, 'media');
	const todo = media
		.map((f) => ({ path: f.name, size: f.size ?? 0, id: f.name.replace(/^media\//, '').replace(/\//g, ':') }))
		.filter((f) => wantsThumb(f.path, f.size) && (force || !existing.has(thumbPath(f.id))));
	log(`Copie web da creare: ${todo.length} (immagini in media/: ${media.length})`);

	let saved = 0;
	let made = 0;
	const queue = [...todo];
	await Promise.all(
		Array.from({ length: 3 }, async () => {
			while (queue.length) {
				const f = queue.shift()!;
				try {
					const { data, error } = await sb.storage.from(BUCKET).download(f.path);
					if (error || !data) throw new Error(error?.message ?? 'download');
					const original = Buffer.from(await data.arrayBuffer());
					// Be as lenient as browsers with slightly malformed files.
					const copy = await sharp(original, { failOn: 'none' })
						.rotate()
						.resize({ width: THUMB_MAX, height: THUMB_MAX, fit: 'inside', withoutEnlargement: true })
						.webp({ quality: 80 })
						.toBuffer();
					if (copy.length >= original.length) continue;
					const up = await sb.storage
						.from(BUCKET)
						.upload(thumbPath(f.id), copy, { contentType: 'image/webp', cacheControl: '3600', upsert: true });
					if (up.error) throw new Error(up.error.message);
					saved += original.length - copy.length;
					made++;
					log(`  ✓ ${f.id}: ${(original.length / 1e6).toFixed(1)} MB → ${(copy.length / 1e3).toFixed(0)} KB`);
				} catch (e) {
					log(`  ✗ ${f.id}: ${e instanceof Error ? e.message : e}`);
				}
			}
		})
	);
	log(`Fatto: ${made} copie, ${(saved / 1e6).toFixed(0)} MB in meno da scaricare per ogni visualizzazione completa.`);
	return { made };
}
