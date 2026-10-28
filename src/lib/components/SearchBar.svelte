<script lang="ts">
	import { goto } from '$app/navigation';
	import { href, pageHref, pageIndex } from '#lib/wiki.svelte.ts';

	let q = $state('');
	let focused = $state(false);
	let active = $state(0);
	let input: HTMLInputElement;

	const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

	const results = $derived.by(() => {
		const n = norm(q.trim());
		if (!n) return [];
		return pageIndex.pages
			.map((p) => {
				const t = norm(p.title);
				const id = norm(p.id);
				const score = t.startsWith(n) ? 3 : t.includes(n) ? 2 : id.includes(n.replace(/\s+/g, '_')) ? 1 : 0;
				return { p, score };
			})
			.filter((r) => r.score > 0)
			.sort((a, b) => b.score - a.score || b.p.rev - a.p.rev)
			.slice(0, 6)
			.map((r) => r.p);
	});

	const total = $derived(results.length + 1);

	function go(i: number) {
		const target = i < results.length ? pageHref(results[i].id) : href(`/search?q=${encodeURIComponent(q.trim())}`);
		q = '';
		input.blur();
		goto(target);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			active = (active + 1) % total;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			active = (active - 1 + total) % total;
		} else if (e.key === 'Enter' && q.trim()) {
			e.preventDefault();
			go(active);
		} else if (e.key === 'Escape') {
			q = '';
			input.blur();
		}
	}

	$effect(() => {
		void q;
		active = 0;
	});
</script>

<svelte:window
	onkeydown={(e) => {
		const t = e.target as HTMLElement;
		const typing = t.closest('input, textarea, select, [contenteditable]');
		if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
			e.preventDefault();
			input.focus();
		}
	}}
/>

<div class="search" class:open={focused && q.trim()}>
	<span class="icon lead">search</span>
	<input
		bind:this={input}
		bind:value={q}
		type="search"
		placeholder="Cerca nel wiki"
		aria-label="Cerca nel wiki"
		autocomplete="off"
		onfocus={() => (focused = true)}
		onblur={() => setTimeout(() => (focused = false), 150)}
		{onkeydown}
	/>
	<kbd class="hint">Ctrl K</kbd>
	{#if focused && q.trim()}
		<ul class="results" role="listbox">
			{#each results as p, i (p.id)}
				<li role="option" aria-selected={i === active}>
					<button class="list-item" class:active={i === active} onmousedown={() => go(i)}>
						<span class="icon">article</span>
						<span class="grow">
							<span class="headline">{p.title}</span>
							<span class="supporting">{p.id}</span>
						</span>
					</button>
				</li>
			{/each}
			<li role="option" aria-selected={active === results.length}>
				<button class="list-item" class:active={active === results.length} onmousedown={() => go(results.length)}>
					<span class="icon">manage_search</span>
					<span class="grow headline">Cerca «{q.trim()}» in tutto il testo</span>
				</button>
			</li>
		</ul>
	{/if}
</div>

<style>
	.search {
		position: relative;
		flex: 1;
		max-width: 720px;
		height: 48px;
		display: flex;
		align-items: center;
		border-radius: var(--md-shape-xl);
		background: var(--md-surface-container-high);
		transition: border-radius 150ms var(--md-ease), background 150ms var(--md-ease);
	}
	.search.open {
		border-radius: var(--md-shape-xl) var(--md-shape-xl) 0 0;
		background: var(--md-surface-container-highest);
	}
	.lead {
		position: absolute;
		left: 16px;
		color: var(--md-on-surface-variant);
		pointer-events: none;
	}
	input {
		width: 100%;
		height: 100%;
		padding: 0 72px 0 52px;
		border: none;
		background: transparent;
		color: var(--md-on-surface);
		font: inherit;
		font-size: 16px;
		border-radius: inherit;
	}
	input:focus {
		outline: none;
	}
	input::-webkit-search-cancel-button {
		display: none;
	}
	.hint {
		position: absolute;
		right: 16px;
		pointer-events: none;
	}
	.search:focus-within .hint {
		display: none;
	}
	.results {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		z-index: 50;
		margin: 0;
		padding: 0 0 8px;
		list-style: none;
		border-top: 1px solid var(--md-outline-variant);
		border-radius: 0 0 var(--md-shape-xl) var(--md-shape-xl);
		background: var(--md-surface-container-highest);
		box-shadow: var(--md-elev-2);
		overflow: hidden;
	}
	.list-item {
		min-height: 52px;
	}
	.list-item.active::after {
		opacity: 0.08;
	}
	@media (max-width: 600px) {
		.hint {
			display: none;
		}
		input {
			padding-right: 16px;
		}
	}
</style>
