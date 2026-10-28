<script lang="ts">
	import { START_PAGE, href, nsTitle, pageHref } from '#lib/wiki.svelte.ts';

	let { id }: { id: string } = $props();

	const crumbs = $derived.by(() => {
		const parts = id.split(':');
		if (parts.at(-1) === START_PAGE) parts.pop();
		return parts.slice(0, -1).map((_, i) => {
			const ns = parts.slice(0, i + 1).join(':');
			return { ns, label: nsTitle(ns) };
		});
	});
</script>

<nav class="crumbs body-m" aria-label="Percorso">
	<a href={href('/')}><span class="icon">home</span></a>
	{#each crumbs as c (c.ns)}
		<span class="icon sep">chevron_right</span>
		<a href={pageHref(c.ns)}>{c.label}</a>
	{/each}
</nav>

<style>
	.crumbs {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 2px;
		min-height: 24px;
		color: var(--md-on-surface-variant);
	}
	a {
		display: inline-flex;
		align-items: center;
		color: inherit;
		text-decoration: none;
		padding: 2px 6px;
		border-radius: var(--md-shape-sm);
	}
	a:hover {
		background: var(--md-surface-container-high);
		color: var(--md-on-surface);
	}
	.icon {
		font-size: 18px;
	}
	.sep {
		color: var(--md-outline);
	}
</style>
