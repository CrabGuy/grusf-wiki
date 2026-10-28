<script lang="ts">
	import { START_PAGE, nsTitle, pageHref, pageIndex, type PageMeta } from '#lib/wiki.svelte.ts';
	import { ui } from '#lib/ui.svelte.ts';

	interface Node {
		ns: string;
		pages: PageMeta[];
		children: Node[];
	}

	// Build the namespace tree, like DokuWiki's sitemap.
	const tree = $derived.by(() => {
		const root: Node = { ns: '', pages: [], children: [] };
		const find = (ns: string): Node => {
			if (!ns) return root;
			const parent = find(ns.split(':').slice(0, -1).join(':'));
			let node = parent.children.find((c) => c.ns === ns);
			if (!node) parent.children.push((node = { ns, pages: [], children: [] }));
			return node;
		};
		for (const p of pageIndex.pages) find(p.id.split(':').slice(0, -1).join(':')).pages.push(p);
		const sort = (n: Node) => {
			n.children.sort((a, b) => nsTitle(a.ns).localeCompare(nsTitle(b.ns), 'it'));
			n.pages.sort((a, b) => (a.id.endsWith(START_PAGE) ? -1 : b.id.endsWith(START_PAGE) ? 1 : a.title.localeCompare(b.title, 'it')));
			n.children.forEach(sort);
		};
		sort(root);
		return root;
	});
</script>

<svelte:head><title>Tutte le pagine · GRUSF Wiki</title></svelte:head>

{#snippet branch(node: Node)}
	<ul class="tree">
		{#each node.children as child (child.ns)}
			<li>
				<details open={child.ns.split(':').length < 2}>
					<summary>
						<span class="icon">folder</span>
						<span class="title-s">{nsTitle(child.ns)}</span>
						<span class="body-s muted">{pageIndex.inNamespace(child.ns).length}</span>
					</summary>
					{@render branch(child)}
				</details>
			</li>
		{/each}
		{#each node.pages as p (p.id)}
			<li>
				<a href={pageHref(p.id)} class="leaf">
					<span class="icon">article</span>
					<span>{p.title}</span>
					<code class="body-s">{p.id}</code>
				</a>
			</li>
		{/each}
	</ul>
{/snippet}

<div class="page narrow">
	<div class="row head">
		<h1 class="headline-m">Tutte le pagine</h1>
		<span class="spacer"></span>
		<span class="body-m muted">{pageIndex.pages.length} pagine</span>
		<button class="btn tonal" onclick={() => ui.newPage()}><span class="icon">add</span> Nuova pagina</button>
	</div>
	<div class="card">
		{@render branch(tree)}
	</div>
</div>

<style>
	.narrow {
		max-width: 880px;
	}
	.head {
		flex-wrap: wrap;
		margin-bottom: 16px;
	}
	h1 {
		margin: 8px 0;
	}
	.tree {
		list-style: none;
		margin: 0;
		padding: 0 0 0 20px;
	}
	.card > :global(.tree) {
		padding-left: 0;
	}
	summary,
	.leaf {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 12px;
		border-radius: var(--md-shape-sm);
		cursor: pointer;
		color: inherit;
		text-decoration: none;
	}
	summary {
		list-style: none;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	summary .icon {
		color: var(--md-primary);
	}
	details[open] > summary .icon {
		font-variation-settings: 'FILL' 1;
	}
	summary:hover,
	.leaf:hover {
		background: var(--md-surface-container-high);
	}
	.leaf .icon {
		color: var(--md-on-surface-variant);
		font-size: 20px;
	}
	.leaf code {
		margin-left: auto;
		font-family: var(--font-mono);
		color: var(--md-outline);
	}
	@media (max-width: 600px) {
		.leaf code {
			display: none;
		}
	}
</style>
