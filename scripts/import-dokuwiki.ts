// Import a DokuWiki installation into Supabase.
//
//   npm run import -- <path> [--users] [--dry-run]
//
// <path> is the DokuWiki root folder (the one containing data/ and conf/) or its data/ folder.
// Uploads data/pages, data/media, data/attic and data/meta/*.changes to the `wiki` bucket
// (same layout, so the files stay plain DokuWiki files), then rebuilds the search index.
// With --users, also creates accounts from conf/users.auth.php: bcrypt passwords are kept,
// so members can log in with their old password; other hash types get a new password.

import fs from 'node:fs';
import path from 'node:path';
import { adminClient, siteUrl } from './_client.ts';
import {
	BUCKET,
	cleanUsername,
	generatePassword,
	reindex,
	usernameToEmail
} from '../supabase/functions/_shared/wiki-core.ts';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const withUsers = args.includes('--users');
const root = args.find((a) => !a.startsWith('--'));

if (!root) {
	console.error('Uso: npm run import -- <cartella DokuWiki> [--users] [--dry-run]');
	process.exit(1);
}

const dataDir = fs.existsSync(path.join(root, 'data', 'pages')) ? path.join(root, 'data') : root;
const confDir = fs.existsSync(path.join(root, 'conf')) ? path.join(root, 'conf') : path.join(dataDir, '..', 'conf');
if (!fs.existsSync(path.join(dataDir, 'pages'))) {
	console.error(`Non trovo la cartella pages/ in ${dataDir}`);
	process.exit(1);
}

const MIME: Record<string, string> = {
	'.txt': 'text/plain; charset=utf-8',
	'.changes': 'text/plain; charset=utf-8',
	'.gz': 'application/gzip',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml',
	'.pdf': 'application/pdf',
	'.doc': 'application/msword',
	'.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'.xls': 'application/vnd.ms-excel',
	'.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	'.odt': 'application/vnd.oasis.opendocument.text',
	'.zip': 'application/zip',
	'.mp3': 'audio/mpeg',
	'.mp4': 'video/mp4'
};

function walk(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = path.join(dir, e.name);
		return e.isDirectory() ? walk(p) : [p];
	});
}

const files: { local: string; remote: string }[] = [];
for (const folder of ['pages', 'media', 'attic', 'meta']) {
	for (const local of walk(path.join(dataDir, folder))) {
		const rel = path.relative(dataDir, local).split(path.sep).join('/');
		if (folder === 'pages' && !rel.endsWith('.txt')) continue;
		if (folder === 'attic' && !rel.endsWith('.txt.gz')) continue;
		if (folder === 'meta' && !rel.endsWith('.changes')) continue;
		if (path.basename(rel).startsWith('_') && folder !== 'meta') continue;
		files.push({ local, remote: rel });
	}
}

console.log(`Trovati ${files.length} file in ${dataDir}`);
for (const folder of ['pages', 'media', 'attic', 'meta']) {
	console.log(`  ${folder}/: ${files.filter((f) => f.remote.startsWith(folder + '/')).length}`);
}
if (dryRun) process.exit(0);

const sb = adminClient();

let done = 0;
let failed = 0;
async function upload(f: { local: string; remote: string }) {
	const ext = f.remote.endsWith('.txt.gz') ? '.gz' : path.extname(f.remote).toLowerCase();
	const { error } = await sb.storage.from(BUCKET).upload(f.remote, fs.readFileSync(f.local), {
		upsert: true,
		contentType: MIME[ext] ?? 'application/octet-stream',
		cacheControl: f.remote.startsWith('attic/') || f.remote.startsWith('media/') ? '3600' : '0'
	});
	if (error) {
		failed++;
		console.error(`  ✗ ${f.remote}: ${error.message}`);
	}
	if (++done % 50 === 0 || done === files.length) process.stdout.write(`\r  caricati ${done}/${files.length}`);
}

const queue = [...files];
await Promise.all(
	Array.from({ length: 6 }, async () => {
		while (queue.length) await upload(queue.shift()!);
	})
);
console.log(failed ? `\n${failed} file non caricati` : '\nTutti i file caricati');

console.log('Ricostruisco l’indice…');
const res = await reindex(sb, (m) => console.log(`  ${m}`));
console.log(`Indice: ${res.pages} pagine, ${res.changes} modifiche`);

if (withUsers) await importUsers();

async function importUsers() {
	const file = path.join(confDir, 'users.auth.php');
	if (!fs.existsSync(file)) {
		console.error(`Non trovo ${file}`);
		return;
	}
	const lines = fs
		.readFileSync(file, 'utf8')
		.split('\n')
		.filter((l) => l.trim() && !l.startsWith('#'));
	const { data: existing } = await sb.from('profiles').select('username');
	const taken = new Set((existing ?? []).map((p) => p.username));
	const newPasswords: string[] = [];

	console.log(`\nImporto ${lines.length} utenti…`);
	for (const line of lines) {
		// login:passwordhash:Real Name:email:groups
		const [login, hash, realName, , groups = ''] = line.split(':').map((s) => decodeURIComponent(s.trim()));
		const username = cleanUsername(login);
		if (!username || taken.has(username)) {
			console.log(`  - ${login}: già presente, salto`);
			continue;
		}
		const isBcrypt = /^\$2[abxy]\$/.test(hash);
		const password = isBcrypt ? undefined : generatePassword();
		const { data, error } = await sb.auth.admin.createUser({
			email: usernameToEmail(username),
			email_confirm: true,
			...(isBcrypt ? { password_hash: hash.replace(/^\$2[xy]\$/, '$2a$') } : { password }),
			user_metadata: { username, display_name: realName }
		});
		if (error || !data.user) {
			console.error(`  ✗ ${login}: ${error?.message}`);
			continue;
		}
		const role = groups.split(',').map((g) => g.trim()).includes('admin') ? 'admin' : 'user';
		const { error: pErr } = await sb
			.from('profiles')
			.insert({ id: data.user.id, username, display_name: realName || username, role });
		if (pErr) {
			console.error(`  ✗ ${login}: ${pErr.message}`);
			await sb.auth.admin.deleteUser(data.user.id);
			continue;
		}
		taken.add(username);
		console.log(`  ✓ ${username}${role === 'admin' ? ' (admin)' : ''}${isBcrypt ? ' - password di DokuWiki mantenuta' : ''}`);
		if (password) newPasswords.push(`${realName || username}\n  sito: ${siteUrl()}\n  utente: ${username}\n  password: ${password}`);
	}
	if (newPasswords.length) {
		console.log('\nQuesti utenti avevano una password in un formato non compatibile, eccone una nuova:\n');
		console.log(newPasswords.join('\n\n'));
	}
}
