import { resolve } from '$app/paths';
import { supabase } from './supabase';
import { session } from './session.svelte';
import { sync, type PendingSave } from './sync.svelte';

export type { SaveBase } from './sync.svelte';
import {
	BUCKET,
	MEETINGS_NS,
	START_PAGE,
	atticPath,
	cleanId,
	extractTitle,
	getNs,
	gunzip,
	idToPath,
	mediaPath
} from '../../supabase/functions/_shared/wiki-core';

export * from '../../supabase/functions/_shared/wiki-core';

export interface PageMeta {
	id: string;
	title: string;
	rev: number;
	updated_at: string;
	updated_by: string | null;
}

export interface Page extends PageMeta {
	content: string;
	size: number;
	/** Set when this is a local version not yet online. */
	pendingKey?: string;
	pending?: PendingSave['state'];
}

export interface ChangeRow {
	page_id: string;
	rev: number;
	type: 'C' | 'E' | 'e' | 'D' | 'R';
	username: string | null;
	summary: string;
	size_change: number;
}

// ------------------------------------------------------------------ links

/** Base-path aware href for an app path like `/w/eventi`. */
export function href(path: string): string {
	return (resolve as (pathname: string) => string)(path.replace(/^\//, ''));
}

export function pageHref(id: string, hash?: string): string {
	return href(`/w/${idToPath(id)}`) + (hash ? `#${hash}` : '');
}

export function editHref(id: string, extra = ''): string {
	return href(`/edit/${idToPath(id)}`) + extra;
}

export function historyHref(id: string): string {
	return href(`/history/${idToPath(id)}`);
}

/** Route param `eventi/tipi/gita` -> `eventi:tipi:gita` */
export function paramToId(param: string | undefined): string {
	return cleanId(decodeURIComponent(param ?? '').replace(/\//g, ':'));
}

// ------------------------------------------------------------- page index

class PageIndex {
	#server = $state<PageMeta[]>([]);
	loaded = $state(false);
	/** Online pages with local, not yet synced saves applied on top. */
	pages = $derived.by(() => {
		if (!sync.entries.length) return this.#server;
		const map = new Map(this.#server.map((p) => [p.id, p]));
		for (const e of sync.entries) {
			if (!e.content.trim()) map.delete(e.id);
			else map.set(e.id, localMeta(e));
		}
		return [...map.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	});
	ids = $derived(new Set(this.pages.map((p) => p.id)));

	async load() {
		const { data, error } = await supabase
			.from('pages')
			.select('id, title, rev, updated_at, updated_by')
			.order('id')
			.limit(10000);
		if (error) throw error;
		this.#server = data ?? [];
		this.loaded = true;
	}

	exists = (id: string) => this.ids.has(id);

	get(id: string) {
		return this.pages.find((p) => p.id === id);
	}

	/** Top-level namespaces, e.g. ['associazione', 'eventi', 'verbali']. */
	get namespaces() {
		const set = new Set<string>();
		for (const p of this.pages) if (p.id.includes(':')) set.add(p.id.split(':')[0]);
		return [...set].sort();
	}

	/** Every namespace (nested too), for pickers. */
	get allNamespaces() {
		const set = new Set<string>();
		for (const p of this.pages) {
			const parts = p.id.split(':').slice(0, -1);
			for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join(':'));
		}
		return [...set].sort();
	}

	inNamespace(ns: string) {
		const prefix = ns ? `${ns}:` : '';
		return this.pages.filter((p) => p.id.startsWith(prefix));
	}

	get meetings() {
		return this.pages
			.filter((p) => getNs(p.id) === MEETINGS_NS && p.id !== `${MEETINGS_NS}:${START_PAGE}`)
			.map((p) => ({ ...p, date: meetingDate(p.id) }))
			.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0) || b.id.localeCompare(a.id));
	}

	get recent() {
		return [...this.pages].sort((a, b) => b.rev - a.rev);
	}
}

export const pageIndex = new PageIndex();

let reloadTimer: ReturnType<typeof setTimeout> | undefined;
sync.onSynced = () => {
	clearTimeout(reloadTimer);
	reloadTimer = setTimeout(() => pageIndex.load().catch(() => {}), 300);
};

function localMeta(e: PendingSave): PageMeta {
	return {
		id: e.id,
		title: extractTitle(e.id, e.content),
		rev: Math.floor(e.queuedAt / 1000),
		updated_at: new Date(e.queuedAt).toISOString(),
		updated_by: session.profile?.username ?? null
	};
}

/** Display name for a namespace: the title of its start page, or a prettified id. */
export function nsTitle(ns: string): string {
	const start = pageIndex.get(`${ns}:${START_PAGE}`);
	if (start) return start.title;
	const last = ns.split(':').pop() ?? ns;
	return last.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

// ------------------------------------------------------------------ pages

/** A page as this device sees it: a local version waiting to sync wins over the online one. */
export async function getPage(id: string): Promise<Page | null> {
	const local = sync.latest(id);
	if (local) {
		if (!local.content.trim()) return null;
		return { ...localMeta(local), content: local.content, size: local.content.length, pendingKey: local.key, pending: local.state };
	}
	const { data, error } = await supabase.from('pages').select('*').eq('id', id).maybeSingle();
	if (error) throw error;
	return data;
}

/** What to pass as `base` when saving an edit of `page`. */
export function saveBase(page: Page | null) {
	return page?.pendingKey ?? page?.rev ?? null;
}

export async function search(q: string) {
	const { data, error } = await supabase.rpc('search_pages', { q });
	if (error) throw error;
	return (data ?? []) as { id: string; title: string; snippet: string; rank: number }[];
}

export async function recentChanges(limit = 50, offset = 0): Promise<ChangeRow[]> {
	const { data, error } = await supabase
		.from('page_changes')
		.select('page_id, rev, type, username, summary, size_change')
		.order('rev', { ascending: false })
		.range(offset, offset + limit - 1);
	if (error) throw error;
	return data ?? [];
}

export async function pageHistory(id: string): Promise<ChangeRow[]> {
	const { data, error } = await supabase
		.from('page_changes')
		.select('page_id, rev, type, username, summary, size_change')
		.eq('page_id', id)
		.order('rev', { ascending: false });
	if (error) throw error;
	return data ?? [];
}

export async function getRevision(id: string, rev: number): Promise<string | null> {
	const { data, error } = await supabase.storage.from(BUCKET).download(atticPath(id, rev));
	if (error || !data) return null;
	return await gunzip(data);
}

// ------------------------------------------------------------------ media

const urlCache = new Map<string, { url: string; expires: number }>();

/** Signed URLs for private media, cached for most of their lifetime. */
export async function mediaUrls(ids: string[]): Promise<Map<string, string>> {
	const now = Date.now();
	const out = new Map<string, string>();
	const missing: string[] = [];
	for (const id of new Set(ids)) {
		const c = urlCache.get(id);
		if (c && c.expires > now) out.set(id, c.url);
		else missing.push(id);
	}
	if (missing.length) {
		const { data } = await supabase.storage.from(BUCKET).createSignedUrls(missing.map(mediaPath), 3600);
		data?.forEach((d, i) => {
			if (!d.signedUrl) return;
			urlCache.set(missing[i], { url: d.signedUrl, expires: now + 50 * 60 * 1000 });
			out.set(missing[i], d.signedUrl);
		});
	}
	return out;
}

/** Upload an image/attachment into the page's namespace. Returns the media id. */
export async function uploadMedia(ns: string, file: File): Promise<string> {
	const dot = file.name.lastIndexOf('.');
	const ext = dot > 0 ? file.name.slice(dot).toLowerCase() : file.type === 'image/png' ? '.png' : '';
	const base = cleanId((dot > 0 ? file.name.slice(0, dot) : file.name).replace(/:/g, '_')) || 'immagine';
	const stamp = file.name === 'image.png' ? `_${Date.now().toString(36)}` : '';
	for (let n = 0; n < 50; n++) {
		const name = `${base}${stamp}${n ? `_${n}` : ''}${ext}`;
		const id = ns ? `${ns}:${name}` : name;
		const { error } = await supabase.storage
			.from(BUCKET)
			.upload(mediaPath(id), file, { upsert: false, contentType: file.type || undefined });
		if (!error) return id;
		if (!/exists|duplicate/i.test(error.message)) throw error;
	}
	throw new Error('Impossibile caricare il file');
}

export async function listMedia(ns: string) {
	const { data } = await supabase.storage
		.from(BUCKET)
		.list(`media/${idToPath(ns)}`, { limit: 1000, sortBy: { column: 'updated_at', order: 'desc' } });
	return (data ?? []).filter((f) => f.id).map((f) => ({ id: ns ? `${ns}:${f.name}` : f.name, name: f.name }));
}

// --------------------------------------------------------------- meetings

const dateFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
const shortFmt = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });

export function meetingDate(id: string): Date | null {
	const m = id.match(/(\d{4})-(\d{2})-(\d{2})/);
	return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export function formatDate(d: Date) {
	return dateFmt.format(d);
}

export function isoDate(d: Date) {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** First free page id for a meeting on `date` (`verbali:2026-10-28`, then `_2`, ...). */
export function meetingId(date: Date): string {
	const base = `${MEETINGS_NS}:${isoDate(date)}`;
	if (!pageIndex.exists(base)) return base;
	for (let n = 2; ; n++) if (!pageIndex.exists(`${base}_${n}`)) return `${base}_${n}`;
}

/** Today's meeting page if it already exists. */
export function todaysMeeting(): PageMeta | undefined {
	return pageIndex.get(`${MEETINGS_NS}:${isoDate(new Date())}`);
}

/**
 * A ready-to-fill meeting template. Attendees and open to-dos are copied
 * from the previous meeting so the secretary only has to adjust them.
 */
export async function meetingTemplate(date: Date): Promise<string> {
	const prev = pageIndex.meetings.find((m) => m.date && m.date < new Date(isoDate(date) + 'T23:59'));
	let attendees = '';
	let todos = '';
	if (prev) {
		const page = await getPage(prev.id);
		const text = page?.content ?? '';
		attendees = text.match(/\*\*Presenti:\*\*[ \t]*(.*)/)?.[1]?.trim() ?? '';
		const todo = text.match(/^=+\s*Cose da fare\s*=+\s*\n([\s\S]*?)(?=^=+.*=+\s*$|$(?![\s\S]))/m)?.[1]?.trim();
		if (todo && /^\|/m.test(todo)) todos = todo;
	}
	const lines = [
		`====== Riunione del ${formatDate(date)} ======`,
		'',
		`  * **Data:** ${shortFmt.format(date)}, ore 21:00`,
		'  * **Luogo:** sala parrocchiale',
		`  * **Presenti:** ${attendees}`,
		'  * **Assenti:** ',
		'  * **Verbalizza:** ',
		'',
		'===== Ordine del giorno =====',
		'',
		'  - ',
		'',
		'===== Discussione =====',
		'',
		'==== 1. ====',
		'',
		''
	];
	if (todos) {
		lines.push(
			'===== Cose da fare dalla riunione precedente =====',
			'',
			`Dal [[${prev!.id}|verbale precedente]]: segna cosa è stato fatto con <del>barrato</del> o aggiorna la tabella.`,
			'',
			todos,
			''
		);
	}
	lines.push(
		'===== Decisioni =====',
		'',
		'  * ',
		'',
		'===== Cose da fare =====',
		'',
		'^ Cosa ^ Chi ^ Entro ^',
		'|      |     |       |',
		'',
		'===== Prossima riunione =====',
		'',
		''
	);
	return lines.join('\n');
}

// ------------------------------------------------------------------ misc

const relFmt = new Intl.RelativeTimeFormat('it', { numeric: 'auto' });

export function timeAgo(input: string | number | Date): string {
	const d = typeof input === 'number' ? new Date(input * 1000) : new Date(input);
	const diff = (d.getTime() - Date.now()) / 1000;
	const abs = Math.abs(diff);
	if (abs < 60) return 'adesso';
	if (abs < 3600) return relFmt.format(Math.round(diff / 60), 'minute');
	if (abs < 86400) return relFmt.format(Math.round(diff / 3600), 'hour');
	if (abs < 86400 * 7) return relFmt.format(Math.round(diff / 86400), 'day');
	return dateFmt.format(d);
}

export function formatRev(rev: number): string {
	return new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(rev * 1000));
}
