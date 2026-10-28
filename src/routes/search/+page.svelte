<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { href, pageHref, search } from '#lib/wiki.svelte.ts';
	import { toast } from '#lib/toast.svelte.ts';

	const q = $derived(page.url.searchParams.get('q') ?? '');
	let input = $state('');
	let results = $state<Awaited<ReturnType<typeof search>> | null>(null);

	$effect(() => {
		const query = q;
		input = query;
		results = null;
		if (query.trim()) search(query.trim()).then((r) => (results = r)).catch((e) => toast.error(e));
	});

	function snippet(s: string) {
		const esc = s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
		return esc.replace(/⟦/g, '<mark>').replace(/⟧/g, '</mark>');
	}
</script>

<svelte:head><title>Cerca: {q} · GRUSF Wiki</title></svelte:head>

<div class="page narrow">
	<form
		class="field"
		onsubmit={(e) => {
			e.preventDefault();
			goto(href(`/search?q=${encodeURIComponent(input.trim())}`));
		}}
	>
		<input bind:value={input} type="search" placeholder="Cerca nel testo di tutte le pagine" aria-label="Cerca" />
	</form>

	{#if !q.trim()}
		<p class="body-m muted">Scrivi qualcosa da cercare.</p>
	{:else if results === null}
		<div class="progress"></div>
	{:else}
		<p class="body-m muted count">{results.length} {results.length === 1 ? 'risultato' : 'risultati'} per «{q}»</p>
		<ul class="list">
			{#each results as r (r.id)}
				<li>
					<a class="result" href={pageHref(r.id)}>
						<span class="title-m">{r.title}</span>
						<span class="body-s id">{r.id}</span>
						<!-- eslint-disable-next-line svelte/no-at-html-tags -- escaped above -->
						<span class="body-m snippet">{@html snippet(r.snippet)}</span>
					</a>
				</li>
			{:else}
				<li class="empty card outlined body-m">
					Nessuna pagina trovata. <button class="btn text" onclick={() => goto(href('/'))}>Torna alla home</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.narrow {
		max-width: 820px;
	}
	.count {
		margin: 16px 4px;
	}
	.result {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 16px;
		border-radius: var(--md-shape-md);
		color: inherit;
		text-decoration: none;
	}
	.result:hover {
		background: var(--md-surface-container-low);
	}
	.result .title-m {
		color: var(--md-primary);
	}
	.id {
		color: var(--md-outline);
		font-family: var(--font-mono);
	}
	.snippet {
		color: var(--md-on-surface-variant);
	}
	.snippet :global(mark) {
		background: var(--md-warning-container);
		color: inherit;
		border-radius: 2px;
		padding: 0 2px;
	}
	.empty {
		padding: 24px;
	}
</style>
