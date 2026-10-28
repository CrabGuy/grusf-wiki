// Download the whole wiki as a plain DokuWiki data/ folder (backup or migration back to DokuWiki).
//
//   npm run export -- [output folder]      (default: backup/<date>)

import fs from 'node:fs';
import path from 'node:path';
import { adminClient } from './_client.ts';
import { BUCKET, listAll } from '../supabase/functions/_shared/wiki-core.ts';

const out = process.argv[2] ?? path.join('backup', new Date().toISOString().slice(0, 10));
const dataDir = path.join(out, 'data');
const sb = adminClient();

const files = [];
for (const folder of ['pages', 'media', 'attic', 'meta']) files.push(...(await listAll(sb, folder)));
console.log(`Scarico ${files.length} file in ${dataDir}`);

let done = 0;
const queue = [...files];
await Promise.all(
	Array.from({ length: 6 }, async () => {
		while (queue.length) {
			const f = queue.shift()!;
			const { data, error } = await sb.storage.from(BUCKET).download(f.name);
			if (error || !data) {
				console.error(`  ✗ ${f.name}: ${error?.message}`);
				continue;
			}
			const dest = path.join(dataDir, ...f.name.split('/'));
			fs.mkdirSync(path.dirname(dest), { recursive: true });
			fs.writeFileSync(dest, Buffer.from(await data.arrayBuffer()));
			if (++done % 50 === 0 || done === files.length) process.stdout.write(`\r  ${done}/${files.length}`);
		}
	})
);
console.log(`\nFatto. La cartella ${dataDir} può essere copiata dentro un'installazione DokuWiki.`);
