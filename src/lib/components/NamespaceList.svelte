<script lang="ts">
	import { START_PAGE, getNs, nsTitle, pageHref, pageIndex, timeAgo } from '#lib/wiki.svelte.ts';

	let { ns, exclude = '' }: { ns: string; exclude?: string } = $props();

	// Direct children: pages and sub-namespaces.
	const items = $derived.by(() => {
		const prefix = ns ? `${ns}:` : '';
		const pages = [];
		const subs = new Map<string, number>();
		for (const p of pageIndex.inNamespace(ns)) {
			const rest = p.id.slice(prefix.length);
			if (rest.includes(':')) {
				const sub = prefix + rest.split(':')[0];
				subs.set(sub, (subs.get(sub) ?? 0) + 1);
			} else if (p.id !== exclude && rest !== START_PAGE) {
				pages.push(p);
			}
		}
		return {
			subs: [...subs].map(([id, count]) => ({ id, count })),
			pages: pages.sort((a, b) => a.title.localeCompare(b.title, 'it'))
		};
	});
</script>

{#if items.subs.length || items.pages.length}
	<ul class="list ns-list">
		{#each items.subs as s (s.id)}
			<li>
				<a class="list-item" href={pageHref(s.id)}>
					<span class="icon">folder</span>
					<span class="grow">
						<span class="headline">{nsTitle(s.id)}</span>
						<span class="supporting">{s.count} {s.count === 1 ? 'pagina' : 'pagine'}</span>
					</span>
					<span class="icon">chevron_right</span>
				</a>
			</li>
		{/each}
		{#each items.pages as p (p.id)}
			<li>
				<a class="list-item" href={pageHref(p.id)}>
					<span class="icon">article</span>
					<span class="grow">
						<span class="headline">{p.title}</span>
						<span class="supporting">{timeAgo(p.updated_at)}{p.updated_by ? ` · ${p.updated_by}` : ''}</span>
					</span>
				</a>
			</li>
		{/each}
	</ul>
{:else}
	<p class="body-m muted">Nessuna pagina in {nsTitle(ns || getNs(exclude))}.</p>
{/if}

<style>
	.ns-list {
		border: 1px solid var(--md-outline-variant);
		border-radius: var(--md-shape-md);
		overflow: hidden;
	}
	.ns-list li + li {
		border-top: 1px solid var(--md-outline-variant);
	}
</style>
