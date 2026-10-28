// Local-first saving. A save goes into an outbox kept in localStorage and is
// shown everywhere right away; a background worker sends the outbox to the
// `wiki` edge function in order. If someone else changed the page meanwhile,
// the server answers 409 and the two versions are merged line by line; only
// edits to the same lines need a person to decide.

import { supabase, callFunction, ApiError } from './supabase';
import { session } from './session.svelte';
import { toast } from './toast.svelte';
import { merge3 } from './merge';
import { extractTitle } from '../../supabase/functions/_shared/wiki-core';

export interface PendingSave {
	key: string;
	id: string;
	content: string;
	summary: string;
	minor: boolean;
	restore: boolean;
	/** Server revision this edit starts from (null: page didn't exist). -1 forces a merge check. */
	baseRev: number | null;
	/** Text this edit started from, the common ancestor for merging. */
	baseContent: string;
	/** Overwrite whatever is online (chosen in the conflict dialog). */
	force: boolean;
	/** Key of an earlier save of the same page that was in flight when this one was made. */
	after: string | null;
	queuedAt: number;
	state: 'queued' | 'syncing' | 'conflict' | 'failed';
	error?: string;
	/** Online version at the time of a conflict. */
	theirs?: { rev: number | null; content: string; by: string | null };
}

/** What an editor started from: a server revision, or the key of a not yet synced save. */
export type SaveBase = number | string | null;

const RETRY = [2, 5, 15, 30, 60];
const draftKey = (id: string) => `grusf-draft:${id}`;

class Sync {
	entries = $state<PendingSave[]>([]);
	online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);
	/** Bumped per page when its online version changed because of a sync. */
	versions = $state<Record<string, number>>({});
	/** Key of the conflict being shown in the resolution dialog. */
	resolving = $state<string | null>(null);
	/** True for a moment after the outbox empties, for the "synced" tick. */
	justSynced = $state(false);

	/** Called after saves reach the server (wired to the page index). */
	onSynced: () => void = () => {};

	#storageKey = '';
	#running = false;
	#again = false;
	#attempt = 0;
	#retryTimer: ReturnType<typeof setTimeout> | undefined;
	#doneTimer: ReturnType<typeof setTimeout> | undefined;
	/** Saves that reached the server in this tab: key -> online revision and text. */
	#resolved = new Map<string, { rev: number; content: string }>();

	get pending() {
		return this.entries.filter((e) => e.state === 'queued' || e.state === 'syncing');
	}
	get problems() {
		return this.entries.filter((e) => e.state === 'conflict' || e.state === 'failed');
	}
	get status(): 'idle' | 'synced' | 'syncing' | 'offline' | 'problem' {
		if (this.problems.length) return 'problem';
		if (this.entries.length) return this.online ? 'syncing' : 'offline';
		return this.justSynced ? 'synced' : 'idle';
	}

	/** Latest local version of a page, if it has changes not yet online. */
	latest(id: string): PendingSave | undefined {
		return this.entries.findLast((e) => e.id === id);
	}

	// ------------------------------------------------------------ lifecycle

	start(userId: string) {
		const key = `grusf-outbox:${userId}`;
		if (this.#storageKey === key) return;
		const first = !this.#storageKey;
		this.#storageKey = key;
		this.entries = this.#read() ?? [];
		if (first) {
			addEventListener('online', () => {
				this.online = true;
				this.#attempt = 0;
				this.kick();
			});
			addEventListener('offline', () => (this.online = false));
			addEventListener('storage', (e) => {
				if (e.key === this.#storageKey) this.entries = this.#read() ?? [];
			});
			document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.kick());
			addEventListener('beforeunload', (e) => {
				if (this.pending.length) e.preventDefault();
			});
		}
		this.kick();
	}

	#read(): PendingSave[] | null {
		try {
			const raw = localStorage.getItem(this.#storageKey);
			return raw ? JSON.parse(raw) : [];
		} catch {
			return null;
		}
	}

	/** Read-modify-write on the stored outbox, so tabs don't overwrite each other. */
	#mutate(fn: (list: PendingSave[]) => void) {
		const list = this.#read() ?? $state.snapshot(this.entries);
		fn(list);
		try {
			localStorage.setItem(this.#storageKey, JSON.stringify(list));
		} catch {
			/* storage full or unavailable: keep it in memory */
		}
		this.entries = list;
	}

	// ---------------------------------------------------------------- saving

	/** Queue a save. Returns immediately; the change is visible everywhere at once. */
	save(input: {
		id: string;
		content: string;
		base: SaveBase;
		baseContent: string;
		summary?: string;
		minor?: boolean;
		restore?: boolean;
		force?: boolean;
	}) {
		const content = input.content.replace(/\r\n/g, '\n');
		this.#mutate((list) => {
			const entry: PendingSave = {
				key: crypto.randomUUID(),
				id: input.id,
				content,
				summary: input.summary ?? '',
				minor: input.minor ?? false,
				restore: input.restore ?? false,
				baseRev: typeof input.base === 'number' ? input.base : null,
				baseContent: input.baseContent,
				force: input.force ?? false,
				after: null,
				queuedAt: Date.now(),
				state: 'queued'
			};
			if (typeof input.base === 'string') {
				const prev = list.find((e) => e.key === input.base);
				const done = this.#resolved.get(input.base);
				if (prev && prev.state !== 'syncing') {
					// Still waiting: fold the new text into it.
					prev.content = content;
					prev.summary = joinSummary(prev.summary, entry.summary);
					prev.minor &&= entry.minor;
					prev.restore &&= entry.restore;
					prev.force ||= entry.force;
					prev.state = 'queued';
					delete prev.error;
					delete prev.theirs;
					return;
				}
				if (prev) {
					// In flight: send this one right after it.
					entry.after = prev.key;
					entry.baseContent = prev.content;
				} else if (done && done.content === input.baseContent) {
					entry.baseRev = done.rev;
				} else {
					// Synced elsewhere (another tab) or merged on the way: make the server
					// answer 409 so the edit gets merged against what is really online.
					entry.baseRev = -1;
				}
			}
			list.push(entry);
		});
		this.kick();
	}

	// ----------------------------------------------------------------- worker

	kick() {
		if (!this.#storageKey) return;
		clearTimeout(this.#retryTimer);
		if (this.#running) {
			this.#again = true;
			return;
		}
		this.#running = true;
		const run = async () => {
			do {
				this.#again = false;
				await this.#flush();
			} while (this.#again);
		};
		const done = () => (this.#running = false);
		// One tab at a time sends the shared outbox.
		if (navigator.locks) navigator.locks.request('grusf-sync', run).finally(done);
		else run().finally(done);
	}

	async #flush() {
		// Whoever held the lock before us is gone: anything marked in flight was interrupted.
		this.#mutate((list) => list.forEach((e) => e.state === 'syncing' && (e.state = 'queued')));
		let sent = false;
		for (;;) {
			if (!navigator.onLine) {
				this.online = false;
				break;
			}
			const entry = (this.#read() ?? this.entries).find((e) => e.state === 'queued' && !e.after);
			if (!entry) break;
			this.#update(entry.key, (e) => (e.state = 'syncing'));
			try {
				const res = await callFunction<{ id: string; rev: number }>('wiki', {
					action: 'save',
					id: entry.id,
					content: entry.content,
					summary: entry.summary,
					minor: entry.minor,
					restore: entry.restore,
					baseRev: entry.force ? undefined : entry.baseRev
				});
				this.#done(entry, res.rev);
				sent = true;
				this.#attempt = 0;
			} catch (e) {
				if (e instanceof ApiError && e.status === 409) {
					const next = await this.#merge(entry);
					if (next === 'sent') sent = true;
					if (next === 'stop') break;
					continue;
				}
				const retry = !(e instanceof ApiError) || e.status === 401 || e.status >= 500;
				if (retry) {
					// Network trouble or expired session: keep it queued and try again later.
					this.#update(entry.key, (x) => {
						x.state = 'queued';
						x.error = e instanceof Error ? e.message : String(e);
					});
					if (e instanceof ApiError && e.status === 401) await supabase.auth.refreshSession().catch(() => {});
					const delay = RETRY[Math.min(this.#attempt++, RETRY.length - 1)];
					this.#retryTimer = setTimeout(() => this.kick(), delay * 1000);
					break;
				}
				this.#update(entry.key, (x) => {
					x.state = 'failed';
					x.error = e instanceof Error ? e.message : String(e);
				});
				toast.show(`«${titleOf(entry)}» non è stata salvata: ${e instanceof Error ? e.message : e}`, {
					error: true,
					action: { label: 'Dettagli', run: () => (this.resolving = entry.key) }
				});
			}
		}
		if (sent) {
			this.onSynced();
			if (!this.entries.length) {
				this.justSynced = true;
				clearTimeout(this.#doneTimer);
				this.#doneTimer = setTimeout(() => (this.justSynced = false), 2500);
			}
		}
	}

	#update(key: string, fn: (e: PendingSave) => void) {
		this.#mutate((list) => {
			const e = list.find((x) => x.key === key);
			if (e) fn(e);
		});
	}

	/** A save reached the server: drop it and let saves queued behind it go. */
	#done(entry: PendingSave, rev: number) {
		this.#resolved.set(entry.key, { rev, content: entry.content });
		this.#mutate((list) => {
			const i = list.findIndex((e) => e.key === entry.key);
			if (i !== -1) list.splice(i, 1);
			for (const next of list.filter((e) => e.after === entry.key)) {
				next.after = null;
				next.baseRev = rev;
				if (next.baseContent !== entry.content) {
					// The earlier save got merged on the way; bring this one up to date too.
					const m = merge3(next.baseContent, next.content, entry.content);
					next.baseContent = entry.content;
					if (m.conflicts) {
						next.state = 'conflict';
						next.theirs = { rev, content: entry.content, by: null };
					} else next.content = m.text;
				}
			}
		});
		this.versions[entry.id] = (this.versions[entry.id] ?? 0) + 1;
	}

	/** The page changed online since the edit started: merge, or ask. */
	async #merge(entry: PendingSave): Promise<'sent' | 'again' | 'stop'> {
		const { data: online, error } = await supabase
			.from('pages')
			.select('rev, content, updated_by')
			.eq('id', entry.id)
			.maybeSingle();
		if (error) {
			this.#update(entry.key, (e) => (e.state = 'queued'));
			this.#retryTimer = setTimeout(() => this.kick(), 5000);
			return 'stop';
		}
		const theirs = online?.content ?? '';
		if (theirs === entry.content) {
			// Already online (e.g. the answer to an earlier attempt got lost).
			this.#done(entry, online?.rev ?? 0);
			return 'sent';
		}
		const m = merge3(entry.baseContent, entry.content, theirs);
		const otherUser = online?.updated_by && online.updated_by !== session.profile?.username ? online.updated_by : null;
		if (!m.conflicts) {
			this.#update(entry.key, (e) => {
				e.content = m.text;
				e.baseContent = theirs;
				e.baseRev = online?.rev ?? null;
				e.state = 'queued';
			});
			if (otherUser && entry.baseRev !== -1) {
				toast.show(`«${titleOf(entry)}»: le tue modifiche sono state unite a quelle di ${otherUser}`);
			}
			return 'again';
		}
		this.#mutate((list) => {
			const e = list.find((x) => x.key === entry.key);
			if (!e) return;
			// Saves queued behind this one build on it: fold them in so there is one thing to resolve.
			for (const next of list.filter((x) => x.after === e.key)) {
				e.content = next.content;
				e.summary = joinSummary(e.summary, next.summary);
				list.splice(list.indexOf(next), 1);
			}
			e.state = 'conflict';
			e.theirs = { rev: online?.rev ?? null, content: theirs, by: online?.updated_by ?? null };
		});
		toast.show(`«${titleOf(entry)}» è stata modificata anche da ${otherUser ?? 'un altro dispositivo'} negli stessi punti`, {
			error: true,
			duration: 15000,
			action: { label: 'Risolvi', run: () => (this.resolving = entry.key) }
		});
		return 'again';
	}

	// -------------------------------------------------------------- conflicts

	/** Try a failed save again. */
	retry(key: string) {
		this.#update(key, (e) => {
			e.state = 'queued';
			delete e.error;
		});
		this.resolving = null;
		this.#attempt = 0;
		this.kick();
	}

	/** Keep my version: overwrite the online one (it stays in the history). */
	keepMine(key: string) {
		this.#update(key, (e) => {
			e.force = true;
			e.state = 'queued';
			delete e.error;
		});
		this.resolving = null;
		this.kick();
	}

	/**
	 * Drop my version. It is kept as an editor draft on this device, so it can
	 * still be recovered from the editor's "restore draft" banner.
	 */
	discard(key: string) {
		const entry = this.entries.find((e) => e.key === key);
		if (!entry) return;
		saveDraft(entry.id, entry.content);
		this.#mutate((list) => {
			const i = list.findIndex((e) => e.key === key);
			if (i !== -1) list.splice(i, 1);
			for (const next of list.filter((e) => e.after === key)) {
				next.after = null;
				next.baseRev = -1;
			}
		});
		this.resolving = null;
		this.versions[entry.id] = (this.versions[entry.id] ?? 0) + 1;
	}

	/** Combine both versions with conflict markers and hand them to the editor. */
	mergeByHand(key: string): string | null {
		const entry = this.entries.find((e) => e.key === key);
		if (!entry?.theirs) return null;
		const by = entry.theirs.by ? `versione di ${entry.theirs.by}` : 'versione online';
		const m = merge3(entry.baseContent, entry.content, entry.theirs.content, { mine: 'la tua versione', theirs: by });
		this.discard(key);
		saveDraft(entry.id, m.text);
		return entry.id;
	}
}

function joinSummary(a: string, b: string) {
	if (!a || a === b) return b;
	if (!b) return a;
	return `${a}; ${b}`.slice(0, 255);
}

export function titleOf(entry: { id: string; content: string; theirs?: { content: string } }) {
	return extractTitle(entry.id, entry.content || entry.theirs?.content || '');
}

function saveDraft(id: string, text: string) {
	try {
		localStorage.setItem(draftKey(id), JSON.stringify({ text, savedAt: Date.now() }));
	} catch {
		/* ignore */
	}
}

export const sync = new Sync();
