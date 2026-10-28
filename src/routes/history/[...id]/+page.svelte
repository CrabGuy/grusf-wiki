<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import {
		formatRev,
		getPage,
		getRevision,
		historyHref,
		pageHistory,
		pageHref,
		paramToId,
		saveBase,
		type ChangeRow,
		type Page
	} from '#lib/wiki.svelte.ts';
	import { diffLines } from '#lib/diff.ts';
	import { toast } from '#lib/toast.svelte.ts';
	import { sync } from '#lib/sync.svelte.ts';
	import WikiContent from '#lib/components/WikiContent.svelte';
	import Breadcrumbs from '#lib/components/Breadcrumbs.svelte';
	import Dialog from '#lib/components/Dialog.svelte';

	const id = $derived(paramToId(page.params.id));
	const selected = $derived(Number(page.url.searchParams.get('rev')) || null);

	let changes = $state<ChangeRow[]>([]);
	let current = $state<Page | null>(null);
	let oldText = $state<string | null>(null);
	let mode = $state<'diff' | 'view'>('diff');
	let restoreOpen = $state(false);

	const TYPE: Record<string, { label: string; icon: string }> = {
		C: { label: 'creata', icon: 'add_circle' },
		E: { label: 'modificata', icon: 'edit' },
		e: { label: 'modifica minore', icon: 'edit_note' },
		D: { label: 'eliminata', icon: 'delete' },
		R: { label: 'ripristinata', icon: 'restore' }
	};

	$effect(() => {
		const pid = id;
		Promise.all([pageHistory(pid), getPage(pid)])
			.then(([c, p]) => {
				changes = c;
				current = p;
			})
			.catch((e) => toast.error(e));
	});

	$effect(() => {
		const rev = selected;
		oldText = null;
		if (rev) getRevision(id, rev).then((t) => (oldText = t ?? ''));
	});

	const diff = $derived(oldText !== null ? diffLines(oldText, current?.content ?? '') : []);
	const isCurrent = $derived(selected !== null && selected === current?.rev);

	function select(rev: number) {
		goto(`${historyHref(id)}?rev=${rev}`, { replaceState: true });
	}

	function restore() {
		restoreOpen = false;
		if (oldText === null || !selected) return;
		sync.save({
			id,
			content: oldText,
			base: saveBase(current),
			baseContent: current?.content ?? '',
			summary: `ripristinata la versione del ${formatRev(selected)}`,
			restore: true
		});
		toast.show('Versione ripristinata');
		goto(pageHref(id));
	}
</script>

<svelte:head><title>Cronologia: {current?.title ?? id} · GRUSF Wiki</title></svelte:head>

<div class="page">
	<Breadcrumbs {id} />
	<h1 class="headline-s">
		Cronologia di <a href={pageHref(id)}>{current?.title ?? id}</a>
	</h1>

	<div class="layout">
		<ul class="list revs card">
			{#each changes as c (c.rev)}
				<li>
					<button class="list-item" class:active={c.rev === selected} onclick={() => select(c.rev)}>
						<span class="icon">{TYPE[c.type]?.icon ?? 'edit'}</span>
						<span class="grow">
							<span class="headline body-m">{formatRev(c.rev)}{c.rev === current?.rev ? ' · attuale' : ''}</span>
							<span class="supporting body-s">
								{c.username ?? '?'} · {c.summary || TYPE[c.type]?.label}
								<span class:plus={c.size_change > 0} class:minus={c.size_change < 0}>
									({c.size_change > 0 ? '+' : ''}{c.size_change})
								</span>
							</span>
						</span>
					</button>
				</li>
			{:else}
				<li class="body-m muted empty">Nessuna modifica registrata.</li>
			{/each}
		</ul>

		<section class="detail">
			{#if !selected}
				<div class="hint card outlined body-m muted">
					<span class="icon">touch_app</span> Scegli una versione per vedere cosa è cambiato o per ripristinarla.
				</div>
			{:else if oldText === null}
				<div class="progress"></div>
			{:else}
				<div class="row wrap toolbar">
					<button class="chip" class:selected={mode === 'diff'} onclick={() => (mode = 'diff')}>
						<span class="icon">difference</span> Differenze con l'attuale
					</button>
					<button class="chip" class:selected={mode === 'view'} onclick={() => (mode = 'view')}>
						<span class="icon">visibility</span> Versione completa
					</button>
					<span class="spacer"></span>
					{#if !isCurrent}
						<button class="btn tonal" onclick={() => (restoreOpen = true)}>
							<span class="icon">restore</span> Ripristina questa versione
						</button>
					{/if}
				</div>
				{#if mode === 'diff'}
					{#if isCurrent}
						<p class="body-m muted">Questa è la versione attuale.</p>
					{:else}
						<pre class="diff">{#each diff as l, i (i)}<span class={l.type}>{l.type === 'add' ? '+ ' : l.type === 'del' ? '- ' : '  '}{l.text}
</span>{/each}</pre>
					{/if}
				{:else}
					<div class="card outlined view"><WikiContent text={oldText} pageId={id} /></div>
				{/if}
			{/if}
		</section>
	</div>
</div>

<Dialog bind:open={restoreOpen} title="Ripristinare questa versione?" icon="restore">
	<p>La versione del {selected ? formatRev(selected) : ''} diventerà quella attuale. Nessuna versione viene persa: anche quella di adesso resta nella cronologia.</p>
	{#snippet actions()}
		<button class="btn text" onclick={() => (restoreOpen = false)}>Annulla</button>
		<button class="btn filled" onclick={restore}>Ripristina</button>
	{/snippet}
</Dialog>

<style>
	h1 {
		margin: 12px 0 24px;
	}
	h1 a {
		text-decoration: none;
	}
	.layout {
		display: grid;
		grid-template-columns: 340px minmax(0, 1fr);
		gap: 24px;
		align-items: start;
	}
	.revs {
		padding: 8px 0;
		max-height: calc(100dvh - 220px);
		overflow-y: auto;
	}
	.revs .list-item {
		min-height: 64px;
	}
	.revs .active {
		background: var(--md-secondary-container);
		color: var(--md-on-secondary-container);
	}
	.plus {
		color: var(--rp-pine);
	}
	.minus {
		color: var(--md-error);
	}
	.empty {
		padding: 16px;
	}
	.hint {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 24px;
	}
	.toolbar {
		margin-bottom: 16px;
	}
	.diff {
		margin: 0;
		padding: 16px 0;
		border-radius: var(--md-shape-md);
		background: var(--md-surface-container-lowest);
		border: 1px solid var(--md-outline-variant);
		font-family: var(--font-mono);
		font-size: 13px;
		line-height: 1.6;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.diff span {
		display: block;
		padding: 0 16px;
	}
	.diff .add {
		background: color-mix(in srgb, var(--rp-foam) 18%, transparent);
	}
	.diff .del {
		background: color-mix(in srgb, var(--rp-love) 16%, transparent);
		text-decoration: line-through;
		text-decoration-color: color-mix(in srgb, var(--rp-love) 50%, transparent);
	}
	.diff .same {
		color: var(--md-on-surface-variant);
	}
	.view {
		padding: 24px;
	}
	@media (max-width: 900px) {
		.layout {
			grid-template-columns: 1fr;
		}
		.revs {
			max-height: 320px;
		}
	}
</style>
