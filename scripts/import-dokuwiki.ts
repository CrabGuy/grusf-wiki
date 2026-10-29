// Import a DokuWiki installation into Supabase.
//
//   npm run import -- <path> [--users] [--replace] [--dry-run]
//
// <path> is the DokuWiki root folder (the one containing data/ and conf/) or its data/ folder.
// Uploads data/pages, media, attic, media_attic and the meta/ + media_meta/ changelogs to the
// `wiki` bucket (same layout, so the files stay plain DokuWiki files), then rebuilds the search index.
// With --users, also creates accounts from users.auth.php (in conf/ or next to data/): bcrypt
// passwords are kept, so members can log in with their old password; other hash types get a new one.
// With --replace, the wiki's current content is deleted first, so it ends up exactly like the
// DokuWiki, and accounts that already exist take the DokuWiki password and name (admins stay admins).

import fs from 'node:fs';
import path from 'node:path';
import { adminClient, siteUrl } from './_client.ts';
import {
	BUCKET,
	cleanUsername,
	generatePassword,
	listAll,
	reindex,
	usernameToEmail
} from '../supabase/functions/_shared/wiki-core.ts';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const withUsers = args.includes('--users');
const replace = args.includes('--replace');
const root = args.find((a) => !a.startsWith('--'));

if (!root) {
	console.error('Uso: npm run import -- <cartella DokuWiki> [--users] [--replace] [--dry-run]');
	process.exit(1);
}

const dataDir = fs.existsSync(path.join(root, 'data', 'pages')) ? path.join(root, 'data') : root;
const usersFile = [path.join(root, 'conf'), root, path.join(dataDir, '..', 'conf'), path.join(dataDir, '..')]
	.map((d) => path.join(d, 'users.auth.php'))
	.find((f) => fs.existsSync(f));
if (!fs.existsSync(path.join(dataDir, 'pages'))) {
	console.error(`Non trovo la cartella pages/ in ${dataDir}`);
	process.exit(1);
}

const MIME: Record<string, string> = {
	'.txt': 'text/plain; charset=utf-8',
	'.changes': 'text/plain; charset=utf-8',
	'.meta': 'text/plain; charset=utf-8',
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

const FOLDERS = ['pages', 'media', 'attic', 'meta', 'media_attic', 'media_meta'];
const files: { local: string; remote: string }[] = [];
for (const folder of FOLDERS) {
	for (const local of walk(path.join(dataDir, folder))) {
		const rel = path.relative(dataDir, local).split(path.sep).join('/');
		if (folder === 'pages' && !rel.endsWith('.txt')) continue;
		if (folder === 'attic' && !rel.endsWith('.txt.gz')) continue;
		// Changelogs and page metadata; DokuWiki rebuilds its search index files itself.
		if (folder.endsWith('meta') && !/\.(changes|meta)$/.test(rel)) continue;
		// Placeholder files and the cookie salt (a server secret).
		if (/^(_dummy|_htcookiesalt)/.test(path.basename(rel))) continue;
		files.push({ local, remote: rel });
	}
}

console.log(`Trovati ${files.length} file in ${dataDir}`);
for (const folder of FOLDERS) {
	console.log(`  ${folder}/: ${files.filter((f) => f.remote.startsWith(folder + '/')).length}`);
}
if (dryRun) process.exit(0);

const sb = adminClient();

if (replace) {
	console.log('Elimino il contenuto attuale del wiki…');
	for (const folder of FOLDERS) {
		const old = (await listAll(sb, folder)).map((f) => f.name);
		for (let i = 0; i < old.length; i += 100) {
			const { error } = await sb.storage.from(BUCKET).remove(old.slice(i, i + 100));
			if (error) throw new Error(error.message);
		}
		if (old.length) console.log(`  ${folder}/: ${old.length} file eliminati`);
	}
}

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
	const file = usersFile;
	if (!file) {
		console.error('Non trovo users.auth.php');
		return;
	}
	const lines = fs
		.readFileSync(file, 'utf8')
		.split('\n')
		.filter((l) => l.trim() && !l.startsWith('#'));
	const { data: existing } = await sb.from('profiles').select('id, username, role');
	const byUsername = new Map((existing ?? []).map((p) => [p.username, p]));
	const taken = new Set(byUsername.keys());
	const newPasswords: string[] = [];

	console.log(`\nImporto ${lines.length} utenti…`);
	for (const line of lines) {
		// login:passwordhash:Real Name:email:groups
		const [login, hash, realName, , groups = ''] = line.split(':').map((s) => decodeURIComponent(s.trim()));
		const username = cleanUsername(login);
		const isBcrypt = /^\$2[abxy]\$/.test(hash);
		const wasAdmin = groups.split(',').map((g) => g.trim()).includes('admin');
		const current = byUsername.get(username);
		let keepAdmin = false;
		if (current && replace && isBcrypt) {
			// The DokuWiki account wins. Supabase silently ignores a password hash on an existing
			// account, so it is recreated with the same username and the DokuWiki password and name.
			// History is stored by username, so nothing else changes; admins stay admins.
			const { error } = await sb.auth.admin.deleteUser(current.id);
			if (error) {
				console.error(`  ✗ ${login}: ${error.message}`);
				continue;
			}
			taken.delete(username);
			keepAdmin = current.role === 'admin';
			console.log(`  ↻ ${username}: account esistente sostituito da quello di DokuWiki`);
		}
		if (!username || taken.has(username)) {
			console.log(`  - ${login}: già presente, salto`);
			continue;
		}
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
		const role = wasAdmin || keepAdmin ? 'admin' : 'user';
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
