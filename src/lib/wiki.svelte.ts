import { resolve } from '$app/paths';
import { supabase } from './supabase';
import { session } from './session.svelte';
import { sync, type PendingSave } from './sync.svelte';

export type { SaveBase } from './sync.svelte';
import {
	BUCKET,
	MEETINGS_NS,
	START_PAGE,
	THUMB_MAX,
	atticPath,
	cleanId,
	extractTitle,
	getNs,
	gunzip,
	idToPath,
	mediaPath,
	thumbPath,
	wantsThumb
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

/** Signed URLs for private files (storage paths), cached for most of their lifetime. */
async function signedUrls(paths: string[]): Promise<Map<string, string>> {
	const now = Date.now();
	const out = new Map<string, string>();
	const missing: string[] = [];
	for (const p of new Set(paths)) {
		const c = urlCache.get(p);
		if (c && c.expires > now) out.set(p, c.url);
		else missing.push(p);
	}
	if (missing.length) {
		const { data } = await supabase.storage.from(BUCKET).createSignedUrls(missing, 3600);
		data?.forEach((d, i) => {
			if (!d.signedUrl) return;
			urlCache.set(missing[i], { url: d.signedUrl, expires: now + 50 * 60 * 1000 });
			out.set(missing[i], d.signedUrl);
		});
	}
	return out;
}

/** Signed URLs of the original media files. */
export async function mediaUrls(ids: string[]): Promise<Map<string, string>> {
	const urls = await signedUrls(ids.map(mediaPath));
	return new Map(ids.flatMap((id) => (urls.has(mediaPath(id)) ? [[id, urls.get(mediaPath(id))!]] : [])));
}

/** Images known to have no web-size copy (small, or a format that isn't resized). */
const noThumb = new Set<string>();

/** URLs to show images with: the web-size copy when there is one, else the original. */
export async function imageUrls(ids: string[]): Promise<Map<string, string>> {
	const candidates = ids.filter((id) => !noThumb.has(id) && wantsThumb(id, Infinity));
	const thumbs = candidates.length ? await signedUrls(candidates.map(thumbPath)) : new Map<string, string>();
	const out = new Map<string, string>();
	const originals: string[] = [];
	for (const id of ids) {
		const t = thumbs.get(thumbPath(id));
		if (t) out.set(id, t);
		else {
			noThumb.add(id);
			originals.push(id);
		}
	}
	if (originals.length) for (const [id, url] of await mediaUrls(originals)) out.set(id, url);
	return out;
}

/** Resize a large image in the browser and store its web-size copy. */
async function uploadThumb(id: string, file: File) {
	if (!wantsThumb(file.name, file.size)) return;
	const bitmap = await createImageBitmap(file);
	const scale = Math.min(1, THUMB_MAX / Math.max(bitmap.width, bitmap.height));
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(bitmap.width * scale);
	canvas.height = Math.round(bitmap.height * scale);
	canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();
	const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.82));
	// Browsers without WebP encoding hand back a PNG, which would not be smaller.
	if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return;
	const { error } = await supabase.storage.from(BUCKET).upload(thumbPath(id), blob, { contentType: 'image/webp', cacheControl: '3600' });
	if (!error) noThumb.delete(id);
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
		if (!error) {
			// The copy is a nicety: if it fails the page simply shows the original.
			await uploadThumb(id, file).catch(() => {});
			return id;
		}
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

/** Page id for a new RT verbale on `date`, following the existing convention (`verbali:2026-10-27_rt`). */
export function meetingId(date: Date): string {
	const base = `${MEETINGS_NS}:${isoDate(date)}_rt`;
	if (!pageIndex.exists(base)) return base;
	for (let n = 2; ; n++) if (!pageIndex.exists(`${base}_${n}`)) return `${base}_${n}`;
}

/** Today's verbale if it already exists. */
export function todaysMeeting(): PageMeta | undefined {
	const today = `${MEETINGS_NS}:${isoDate(new Date())}`;
	return pageIndex.get(`${today}_rt`) ?? pageIndex.get(today);
}

// Verbali are written by different people: "Presenti:", "**Presenti**:", "**PRESENTI**:",
// "  * **Presenti:** ..." and "  ***presenti**:" (a list item without the space).
const ATTENDEES = /^[ \t]*(?:[*-][ \t]*)?(?:\*\*|\/\/)?presenti[ \t]*(?:\*\*|\/\/)?[ \t]*:[ \t]*(?:\*\*|\/\/)?[ \t]*(\S.*)$/im;

/** Attendees line of a verbale, whichever way it was written. */
export function attendeesOf(text: string): string {
	return text.match(ATTENDEES)?.[1]?.trim() ?? '';
}

/**
 * A new RT verbale in the style the existing ones use, with the attendees of the previous RT
 * already filled in so whoever writes it only has to adjust them.
 */
export async function meetingTemplate(date: Date): Promise<string> {
	const before = pageIndex.meetings.filter((m) => m.date && m.date < new Date(isoDate(date) + 'T00:00'));
	const prev = before.find((m) => /_rt(_\d+)?$/.test(m.id)) ?? before[0];
	const attendees = prev ? attendeesOf((await getPage(prev.id))?.content ?? '') : '';
	const weekday = new Intl.DateTimeFormat('it-IT', { weekday: 'long' }).format(date);
	const heading = `**VERBALE RT ${weekday} ${formatDate(date)}**`.toUpperCase();
	return [heading, '', `**PRESENTI**: ${attendees}`, '', ''].join('\n');
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
