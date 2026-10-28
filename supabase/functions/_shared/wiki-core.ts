// Shared DokuWiki helpers.
//
// This file has no imports so it can be used, unchanged, by:
//   - the Supabase Edge Functions (Deno)
//   - the maintenance scripts in /scripts (Node >= 22, native type stripping)
//   - the SvelteKit frontend (Vite)
//
// Storage layout mirrors a DokuWiki `data/` directory inside the `wiki` bucket:
//   pages/<ns>/<page>.txt                current page text
//   attic/<ns>/<page>.<rev>.txt.gz       old revisions (gzip)
//   meta/<ns>/<page>.changes             per-page changelog (tab separated)
//   media/<ns>/<file>                    images and attachments

export const BUCKET = 'wiki';

/** Usernames are mapped to synthetic e-mails because Supabase Auth logs in by e-mail. */
export const USERNAME_EMAIL_DOMAIN = 'users.grusf.wiki';

export const START_PAGE = 'start';
export const MEETINGS_NS = 'verbali';

export function usernameToEmail(username: string): string {
	return `${cleanUsername(username)}@${USERNAME_EMAIL_DOMAIN}`;
}

export function cleanUsername(username: string): string {
	return username
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/\s+/g, '.')
		.replace(/[^a-z0-9._-]/g, '');
}

/** Same rules as DokuWiki's cleanID(): lowercase, `_` for spaces, `:` as namespace separator. */
export function cleanId(raw: string): string {
	return raw
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[/;]/g, ':')
		.replace(/\s+/g, '_')
		.replace(/[^a-z0-9:._-]/g, '_')
		.replace(/_{2,}/g, '_')
		.replace(/:{2,}/g, ':')
		.replace(/(^[:._-]+|[:._-]+$)/g, '')
		.split(':')
		.map((p) => p.replace(/(^[._-]+|[._-]+$)/g, ''))
		.filter(Boolean)
		.join(':');
}

export function getNs(id: string): string {
	const i = id.lastIndexOf(':');
	return i === -1 ? '' : id.slice(0, i);
}

export function noNs(id: string): string {
	return id.slice(id.lastIndexOf(':') + 1);
}

export function idToPath(id: string): string {
	return id.replace(/:/g, '/');
}

export function pagePath(id: string): string {
	return `pages/${idToPath(id)}.txt`;
}

export function atticPath(id: string, rev: number): string {
	return `attic/${idToPath(id)}.${rev}.txt.gz`;
}

export function changesPath(id: string): string {
	return `meta/${idToPath(id)}.changes`;
}

export function mediaPath(id: string): string {
	return `media/${idToPath(id)}`;
}

/** `pages/a/b.txt` -> `a:b` */
export function pathToId(path: string): string {
	return path
		.replace(/^pages\//, '')
		.replace(/\.txt$/, '')
		.replace(/\//g, ':');
}

/**
 * Resolve a link target the way DokuWiki does:
 * `:a:b` absolute, `.x` / `..:x` relative, `ns:` -> `ns:start`, bare names in the current namespace.
 */
export function resolveId(target: string, currentNs: string): string {
	let t = target.trim();
	if (!t) return '';
	const endsWithColon = t.endsWith(':');
	let id: string;
	if (t.startsWith(':')) {
		id = t.slice(1);
	} else if (t.startsWith('.')) {
		const parts = currentNs ? currentNs.split(':') : [];
		while (t.startsWith('..')) {
			parts.pop();
			t = t.replace(/^\.\.:?/, '');
		}
		t = t.replace(/^\.:?/, '');
		id = [...parts, t].filter(Boolean).join(':');
	} else if (t.includes(':')) {
		id = t;
	} else {
		id = currentNs ? `${currentNs}:${t}` : t;
	}
	id = cleanId(id);
	if (endsWithColon || !id) id = id ? `${id}:${START_PAGE}` : START_PAGE;
	return id;
}

/** First DokuWiki heading of a page, falling back to the page name. */
export function extractTitle(id: string, text: string): string {
	const m = text.match(/^[ \t]*={2,6}[ \t]*(.+?)[ \t]*={2,6}[ \t]*$/m);
	if (m) return m[1].trim();
	const name = noNs(id) === START_PAGE && getNs(id) ? noNs(getNs(id)) : noNs(id);
	return name.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Changelog (DokuWiki `.changes` format)
// date \t ip \t type \t id \t user \t summary \t extra \t sizechange
// types: C = create, E = edit, e = minor edit, D = delete, R = revert
// ---------------------------------------------------------------------------

export type ChangeType = 'C' | 'E' | 'e' | 'D' | 'R';

export interface Change {
	rev: number;
	type: ChangeType;
	id: string;
	user: string;
	summary: string;
	sizeChange: number;
}

export function parseChanges(text: string): Change[] {
	return text
		.split('\n')
		.filter((l) => l.trim())
		.map((line) => {
			const f = line.split('\t');
			return {
				rev: Number(f[0]),
				type: (f[2] || 'E') as ChangeType,
				id: f[3] ?? '',
				user: f[4] ?? '',
				summary: f[5] ?? '',
				sizeChange: Number(f[7] ?? 0) || 0
			};
		})
		.filter((c) => Number.isFinite(c.rev) && c.rev > 0);
}

export function formatChange(c: Change): string {
	const clean = (s: string) => s.replace(/[\t\n\r]/g, ' ');
	return [c.rev, '127.0.0.1', c.type, c.id, clean(c.user), clean(c.summary), '', c.sizeChange].join('\t') + '\n';
}

// ---------------------------------------------------------------------------
// gzip helpers (CompressionStream exists in Deno, Node >= 18 and browsers)
// ---------------------------------------------------------------------------

export async function gzip(text: string): Promise<Uint8Array> {
	const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(data: Blob | ArrayBuffer | Uint8Array): Promise<string> {
	const blob = data instanceof Blob ? data : new Blob([data as BlobPart]);
	const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
	return await new Response(stream).text();
}

export function byteLength(text: string): number {
	return new TextEncoder().encode(text).length;
}

// ---------------------------------------------------------------------------
// Server-side operations. `sb` is a supabase-js client created with the
// service role / secret key. Typed loosely to keep this file import-free.
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
type Sb = any;

async function readText(sb: Sb, path: string): Promise<string | null> {
	const { data, error } = await sb.storage.from(BUCKET).download(path);
	if (error || !data) return null;
	return await (data as Blob).text();
}

async function writeFile(sb: Sb, path: string, body: string | Uint8Array, contentType: string) {
	const { error } = await sb.storage
		.from(BUCKET)
		.upload(path, body, { upsert: true, contentType, cacheControl: '0' });
	if (error) throw new Error(`upload ${path}: ${error.message}`);
}

export class ConflictError extends Error {
	currentRev: number;
	constructor(currentRev: number) {
		super('La pagina è stata modificata da qualcun altro nel frattempo.');
		this.currentRev = currentRev;
	}
}

export interface SaveInput {
	id: string;
	content: string;
	summary?: string;
	minor?: boolean;
	user: string;
	/** Revision the editor started from; null for new pages. Omit to skip the conflict check. */
	baseRev?: number | null;
	type?: ChangeType;
}

/** Save (or delete, when content is empty) a page, keeping attic + changelog + index in sync. */
export async function savePage(sb: Sb, input: SaveInput) {
	const id = cleanId(input.id);
	if (!id) throw new Error('ID pagina non valido');
	const content = input.content.replace(/\r\n/g, '\n');

	const { data: current } = await sb.from('pages').select('rev, size, content').eq('id', id).maybeSingle();

	if (input.baseRev !== undefined && (current?.rev ?? null) !== (input.baseRev ?? null)) {
		throw new ConflictError(current?.rev ?? 0);
	}
	if (current && current.content === content) return { id, rev: current.rev, unchanged: true };
	if (!current && !content.trim()) return { id, rev: 0, unchanged: true };

	let rev = Math.floor(Date.now() / 1000);
	if (current && rev <= current.rev) rev = current.rev + 1;

	// Make sure the previous revision is in the attic (older DokuWiki installs only stored it there on edit).
	if (current) await writeFile(sb, atticPath(id, current.rev), await gzip(current.content), 'application/gzip');

	const deleting = !content.trim();
	const type: ChangeType = input.type ?? (deleting ? 'D' : !current ? 'C' : input.minor ? 'e' : 'E');
	const size = deleting ? 0 : byteLength(content);
	const change: Change = {
		rev,
		type,
		id,
		user: input.user,
		summary: input.summary?.trim() || (type === 'C' ? 'creata' : type === 'D' ? 'eliminata' : ''),
		sizeChange: size - (current?.size ?? 0)
	};

	if (deleting) {
		await sb.storage.from(BUCKET).remove([pagePath(id)]);
		await sb.from('pages').delete().eq('id', id);
	} else {
		await writeFile(sb, pagePath(id), content, 'text/plain; charset=utf-8');
		await writeFile(sb, atticPath(id, rev), await gzip(content), 'application/gzip');
		const { error } = await sb.from('pages').upsert({
			id,
			title: extractTitle(id, content),
			content,
			rev,
			size,
			updated_at: new Date(rev * 1000).toISOString(),
			updated_by: input.user
		});
		if (error) throw new Error(error.message);
	}

	const oldChanges = (await readText(sb, changesPath(id))) ?? '';
	await writeFile(sb, changesPath(id), oldChanges + formatChange(change), 'text/plain; charset=utf-8');
	await sb.from('page_changes').upsert(changeRow(change), { onConflict: 'page_id,rev' });

	return { id, rev, unchanged: false };
}

function changeRow(c: Change) {
	return {
		page_id: c.id,
		rev: c.rev,
		type: c.type,
		username: c.user,
		summary: c.summary,
		size_change: c.sizeChange
	};
}

/** Recursively list every file under a prefix of the bucket. */
export async function listAll(sb: Sb, prefix: string): Promise<{ name: string; updated_at?: string }[]> {
	const out: { name: string; updated_at?: string }[] = [];
	const pageSize = 1000;
	for (let offset = 0; ; offset += pageSize) {
		const { data, error } = await sb.storage.from(BUCKET).list(prefix, { limit: pageSize, offset });
		if (error) throw new Error(error.message);
		for (const item of data ?? []) {
			const full = prefix ? `${prefix}/${item.name}` : item.name;
			if (item.id === null) out.push(...(await listAll(sb, full)));
			else if (item.name !== '.emptyFolderPlaceholder') out.push({ name: full, updated_at: item.updated_at });
		}
		if (!data || data.length < pageSize) break;
	}
	return out;
}

/**
 * Rebuild the `pages` and `page_changes` tables from the files in storage.
 * Run this after uploading DokuWiki data directly to the bucket.
 */
export async function reindex(sb: Sb, log: (msg: string) => void = () => {}) {
	const pageFiles = (await listAll(sb, 'pages')).filter((f) => f.name.endsWith('.txt'));
	// Skip the global changelogs (_dokuwiki.changes, _media.changes): per-page files have the same entries.
	const metaFiles = (await listAll(sb, 'meta')).filter((f) => f.name.endsWith('.changes') && !/(^|\/)_/.test(f.name));
	log(`${pageFiles.length} pagine, ${metaFiles.length} changelog`);

	const lastChange = new Map<string, Change>();
	const changeRows: ReturnType<typeof changeRow>[] = [];
	for (const f of metaFiles) {
		const text = await readText(sb, f.name);
		if (!text) continue;
		const fallbackId = f.name.replace(/^meta\//, '').replace(/\.changes$/, '').replace(/\//g, ':');
		for (const c of parseChanges(text)) {
			c.id = c.id || fallbackId;
			changeRows.push(changeRow(c));
			const prev = lastChange.get(c.id);
			if (!prev || prev.rev < c.rev) lastChange.set(c.id, c);
		}
	}

	const rows = [];
	for (const f of pageFiles) {
		const id = pathToId(f.name);
		const content = ((await readText(sb, f.name)) ?? '').replace(/\r\n/g, '\n');
		const last = lastChange.get(id);
		const rev = last?.rev ?? Math.floor(new Date(f.updated_at ?? Date.now()).getTime() / 1000);
		rows.push({
			id,
			title: extractTitle(id, content),
			content,
			rev,
			size: byteLength(content),
			updated_at: new Date(rev * 1000).toISOString(),
			updated_by: last?.user ?? null
		});
	}

	await sb.from('pages').delete().neq('id', '');
	for (let i = 0; i < rows.length; i += 200) {
		const { error } = await sb.from('pages').upsert(rows.slice(i, i + 200));
		if (error) throw new Error(error.message);
	}
	await sb.from('page_changes').delete().gt('rev', -1);
	for (let i = 0; i < changeRows.length; i += 500) {
		const { error } = await sb
			.from('page_changes')
			.upsert(changeRows.slice(i, i + 500), { onConflict: 'page_id,rev', ignoreDuplicates: true });
		if (error) throw new Error(error.message);
	}
	log('indice ricostruito');
	return { pages: rows.length, changes: changeRows.length };
}

// Short, common Italian words without accents, easy to read out loud or type on a phone.
const WORDS = (
	'acqua albero alba amico anello angolo anno ape arancia arco argento aria armadio asino astro autunno ' +
	'bacio balena banco barca basilico bosco bottone braccio brezza bruco buco burro cacao caffe calma ' +
	'camino campo cane canto carta casa castello cavallo cena cervo chiave cielo ciliegia cinema cipolla ' +
	'citta colle colore coniglio coperta corda corno cortile cosmo cuoco cuore cupola delfino dente ' +
	'diamante dito dolce domani drago duna erba estate faro farfalla fata fiume fiore foglia fontana ' +
	'formica forno fragola freccia frutto fumo fungo gabbiano galassia gatto gelato gelso ghianda giardino ' +
	'giglio giorno gioco giraffa gomma grano grillo gufo isola lago lampada lana lavagna legno leone ' +
	'libro limone lince lino luce luna lupo mandorla mano mare marmo matita mela melone menta miele ' +
	'mirtillo molla monte mulino muschio musica neve nido noce nota notte nuvola oca oliva ombra onda ' +
	'orso orto ostrica pace palla panda pane panino papavero parco passero pasta penna pepe pera pesca ' +
	'pesce piano pietra pino pioggia piuma polpo ponte porto prato primula quadro radice ragno rame rana ' +
	'riccio riso roccia rosa rubino ruota sabbia sale salice salvia scala scoglio seme sedia sentiero ' +
	'serpente sole sorriso spiga stella strada sughero tavolo tazza teatro tela tempo terra tetto tigre ' +
	'timo topo torre torta treno trifoglio tulipano uva uovo vaso vela vento verde vetro viola vulcano ' +
	'zaino zebra zucca'
).split(' ');

/** Readable password like `gatto-luna-pane-42`: three Italian words plus a two-digit number. */
export function generatePassword(): string {
	const r = crypto.getRandomValues(new Uint32Array(4));
	const words = Array.from(r.slice(0, 3), (n) => WORDS[n % WORDS.length]);
	return [...words, String(10 + (r[3] % 90))].join('-');
}
