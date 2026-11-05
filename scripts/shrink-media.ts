// Shrink large images already stored in media/ and media_attic/, the same way the editor does for new uploads
// (longest side at most 2560 px). File names stay the same, so every page and old revision keeps working:
// JPEGs are re-encoded as JPEG, PNGs stay PNG (with a reduced colour palette, which suits posters).
// Every replaced file is first saved under backup/shrink-<date>/ on this computer.
//
//   npm run shrink-media -- --dry-run     only report what would be saved
//   npm run shrink-media

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { adminClient } from './_client.ts';
import { BUCKET, listAll } from '../supabase/functions/_shared/wiki-core.ts';

const MAX = 2560;
const MIN_BYTES = 1_000_000;
const dryRun = process.argv.includes('--dry-run');
const sb = adminClient();
const backupDir = path.join('backup', `shrink-${new Date().toISOString().slice(0, 10)}`);

async function shrink(original: Buffer, ext: string): Promise<Buffer> {
	const img = () =>
		sharp(original, { failOn: 'none' })
			.rotate()
			.resize({ width: MAX, height: MAX, fit: 'inside', withoutEnlargement: true });
	if (ext === 'png') {
		const [palette, full] = await Promise.all([
			img().png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 }).toBuffer(),
			img().png({ compressionLevel: 9, effort: 10 }).toBuffer()
		]);
		return palette.length < full.length ? palette : full;
	}
	return img().jpeg({ quality: 85, mozjpeg: true }).toBuffer();
}

const files = [...(await listAll(sb, 'media')), ...(await listAll(sb, 'media_attic'))].filter(
	(f) => /\.(png|jpe?g)$/i.test(f.name) && (f.size ?? 0) >= MIN_BYTES
);
console.log(`Immagini sopra ${MIN_BYTES / 1e6} MB: ${files.length}${dryRun ? ' (prova, nessun file viene modificato)' : ''}`);

let before = 0;
let after = 0;
for (const f of files) {
	const ext = f.name.split('.').pop()!.toLowerCase().replace('jpeg', 'jpg');
	const { data, error } = await sb.storage.from(BUCKET).download(f.name);
	if (error || !data) {
		console.log(`  ✗ ${f.name}: ${error?.message}`);
		continue;
	}
	const original = Buffer.from(await data.arrayBuffer());
	const small = await shrink(original, ext);
	// Not worth touching a file for less than 20% gain.
	if (small.length > original.length * 0.8) {
		console.log(`  = ${f.name}: già compatta`);
		continue;
	}
	before += original.length;
	after += small.length;
	const meta = await sharp(small).metadata();
	console.log(
		`  ✓ ${f.name}: ${(original.length / 1e6).toFixed(1)} MB → ${(small.length / 1e6).toFixed(1)} MB (${meta.width}×${meta.height})`
	);
	if (dryRun) continue;
	const backup = path.join(backupDir, f.name);
	fs.mkdirSync(path.dirname(backup), { recursive: true });
	fs.writeFileSync(backup, original);
	const up = await sb.storage.from(BUCKET).upload(f.name, small, {
		upsert: true,
		contentType: ext === 'png' ? 'image/png' : 'image/jpeg',
		cacheControl: '3600'
	});
	if (up.error) console.log(`    ✗ upload: ${up.error.message}`);
}
console.log(
	`\n${dryRun ? 'Si risparmierebbero' : 'Risparmiati'} ${((before - after) / 1e6).toFixed(0)} MB ` +
		`(${(before / 1e6).toFixed(0)} → ${(after / 1e6).toFixed(0)} MB).` +
		(dryRun ? '' : ` Originali salvati in ${backupDir}/`)
);
