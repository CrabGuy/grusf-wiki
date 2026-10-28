<script lang="ts">
	import { goto } from '$app/navigation';
	import { sync, titleOf, type PendingSave } from '#lib/sync.svelte.ts';
	import { diffLines } from '#lib/diff.ts';
	import { editHref, pageHref, timeAgo } from '#lib/wiki.svelte.ts';
	import { toast } from '#lib/toast.svelte.ts';
	import Dialog from './Dialog.svelte';

	let menuOpen = $state(false);

	const ICON = { idle: '', synced: 'cloud_done', syncing: 'cloud_sync', offline: 'cloud_off', problem: 'sync_problem' };
	const LABEL = {
		idle: '',
		synced: 'Tutto salvato online',
		syncing: 'Sincronizzazione in corso…',
		offline: 'Sei offline: le modifiche sono salvate su questo dispositivo',
		problem: 'Alcune modifiche richiedono la tua attenzione'
	};

	function describe(e: PendingSave) {
		if (e.state === 'syncing') return 'Invio in corso…';
		if (e.state === 'conflict') return `Modificata anche da ${e.theirs?.by ?? 'qualcun altro'} negli stessi punti`;
		if (e.state === 'failed') return e.error ?? 'Errore';
		if (!sync.online) return 'In attesa di connessione';
		return e.error ? 'Nuovo tentativo a breve' : 'In coda';
	}

	const entry = $derived(sync.entries.find((e) => e.key === sync.resolving));

	/** What differs between my version and the online one, to help choose. */
	const changes = $derived.by(() => {
		if (!entry?.theirs) return [];
		return diffLines(entry.theirs.content, entry.content)
			.filter((d) => d.type !== 'same' && d.text.trim())
			.slice(0, 30);
	});

	function open(e: PendingSave) {
		menuOpen = false;
		if (e.state === 'conflict' || e.state === 'failed') sync.resolving = e.key;
		else goto(pageHref(e.id));
	}

	function byHand(key: string) {
		const id = sync.mergeByHand(key);
		if (id) goto(editHref(id, '?merge=1'));
	}

	function keepTheirs(key: string) {
		const id = entry?.id;
		sync.discard(key);
		toast.show('Tenuta la versione online. La tua resta come bozza nell’editor di questa pagina.', {
			action: id ? { label: 'Apri', run: () => goto(editHref(id)) } : undefined
		});
	}
</script>

{#if sync.status !== 'idle'}
	<div class="sync">
		<button
			class="icon-btn {sync.status}"
			title={LABEL[sync.status]}
			aria-label={LABEL[sync.status]}
			aria-expanded={menuOpen}
			onclick={() => (menuOpen = !menuOpen)}
		>
			<span class="icon">{ICON[sync.status]}</span>
			{#if sync.entries.length > 1}<span class="badge">{sync.entries.length}</span>{/if}
		</button>
		{#if menuOpen}
			<button class="menu-scrim" aria-label="Chiudi" tabindex="-1" onclick={() => (menuOpen = false)}></button>
			<div class="menu-card" role="menu">
				<p class="head body-m">{LABEL[sync.status]}</p>
				{#each sync.entries as e (e.key)}
					<button class="list-item" role="menuitem" onclick={() => open(e)}>
						<span class="icon" class:warn={e.state === 'conflict' || e.state === 'failed'}>
							{e.state === 'conflict' ? 'call_split' : e.state === 'failed' ? 'error' : e.content ? 'edit' : 'delete'}
						</span>
						<span class="grow">
							<span class="headline">{titleOf(e)}</span>
							<span class="supporting">{describe(e)} · {timeAgo(e.queuedAt)}</span>
						</span>
					</button>
				{:else}
					<p class="empty body-s muted">Ogni modifica è già online.</p>
				{/each}
				{#if sync.pending.length && sync.online}
					<button class="btn text retry" onclick={() => sync.kick()}><span class="icon">sync</span> Riprova ora</button>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<Dialog
	bind:open={() => !!entry, (v) => !v && (sync.resolving = null)}
	title={entry?.state === 'failed' ? 'Modifica non salvata' : 'Modifiche in conflitto'}
	icon={entry?.state === 'failed' ? 'error' : 'call_split'}
	wide={entry?.state === 'conflict'}
>
	{#if entry?.state === 'conflict'}
		<p>
			Mentre salvavi «{titleOf(entry)}», <strong>{entry.theirs?.by ?? 'qualcun altro'}</strong> ha cambiato le stesse righe.
			Le modifiche in punti diversi della pagina sono già state unite; per queste scegli tu.
		</p>
		{#if changes.length}
			<div class="diff">
				{#each changes as d, i (i)}
					<div class={d.type}><span class="sign">{d.type === 'add' ? 'tua' : 'online'}</span>{d.text}</div>
				{/each}
			</div>
		{/if}
		<p class="body-s muted">Qualunque cosa scegli, l’altra versione resta nella cronologia della pagina.</p>
	{:else if entry}
		<p>«{titleOf(entry)}» non è stata salvata online: {entry.error}</p>
		<p class="body-s muted">Il testo è ancora su questo dispositivo.</p>
	{/if}
	{#snippet actions()}
		{#if entry?.state === 'conflict'}
			<button class="btn text" onclick={() => keepTheirs(entry.key)}>Tieni quella online</button>
			<button class="btn text" onclick={() => sync.keepMine(entry.key)}>Tieni la mia</button>
			<button class="btn filled" onclick={() => byHand(entry.key)}><span class="icon">merge</span> Unisci a mano</button>
		{:else if entry}
			<button class="btn text danger" onclick={() => keepTheirs(entry.key)}>Scarta</button>
			<button class="btn filled" onclick={() => sync.retry(entry.key)}>Riprova</button>
		{/if}
	{/snippet}
</Dialog>

<style>
	.sync {
		position: relative;
	}
	.icon-btn {
		position: relative;
	}
	.synced .icon {
		color: var(--md-primary);
	}
	.syncing .icon {
		animation: pulse 1.2s ease-in-out infinite;
	}
	.offline .icon {
		color: var(--md-on-surface-variant);
	}
	.problem .icon,
	.warn {
		color: var(--md-error) !important;
	}
	@keyframes pulse {
		50% {
			opacity: 0.4;
		}
	}
	.badge {
		position: absolute;
		top: 4px;
		right: 2px;
		min-width: 16px;
		height: 16px;
		padding: 0 4px;
		border-radius: 8px;
		background: var(--md-error);
		color: var(--md-on-error);
		font-size: 11px;
		font-weight: 600;
		line-height: 16px;
	}
	.menu-scrim {
		position: fixed;
		inset: 0;
		z-index: 49;
		border: none;
		background: transparent;
	}
	.menu-card {
		position: absolute;
		right: 0;
		top: 48px;
		z-index: 50;
		width: min(340px, calc(100vw - 16px));
		padding: 8px 0;
		border-radius: var(--md-shape-sm);
		background: var(--md-surface-container);
		box-shadow: var(--md-elev-2);
	}
	.head {
		margin: 0;
		padding: 8px 16px 12px;
		border-bottom: 1px solid var(--md-outline-variant);
		margin-bottom: 4px;
	}
	.empty {
		margin: 0;
		padding: 8px 16px;
	}
	.retry {
		margin: 4px 8px 0 auto;
		display: flex;
	}
	.diff {
		max-height: 240px;
		overflow: auto;
		border-radius: var(--md-shape-sm);
		background: var(--md-surface-container);
		font-family: var(--font-mono);
		font-size: 13px;
		line-height: 1.5;
	}
	.diff div {
		display: flex;
		gap: 8px;
		padding: 2px 8px;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.diff .add {
		background: color-mix(in srgb, var(--rp-pine) 14%, transparent);
	}
	.diff .del {
		background: color-mix(in srgb, var(--rp-love) 12%, transparent);
	}
	.sign {
		flex: none;
		width: 44px;
		color: var(--md-on-surface-variant);
		font-size: 11px;
		text-transform: uppercase;
	}
</style>
