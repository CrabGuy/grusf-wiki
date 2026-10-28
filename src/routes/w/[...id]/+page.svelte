<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { Heading } from '#lib/dokuwiki.ts';
	import {
		START_PAGE,
		editHref,
		getNs,
		getPage,
		historyHref,
		noNs,
		nsTitle,
		pageIndex,
		paramToId,
		timeAgo,
		type Page
	} from '#lib/wiki.svelte.ts';
	import { toast } from '#lib/toast.svelte.ts';
	import { ui } from '#lib/ui.svelte.ts';
	import { sync } from '#lib/sync.svelte.ts';
	import WikiContent from '#lib/components/WikiContent.svelte';
	import Breadcrumbs from '#lib/components/Breadcrumbs.svelte';
	import NamespaceList from '#lib/components/NamespaceList.svelte';

	const requested = $derived(paramToId(page.params.id) || START_PAGE);

	let data = $state<Page | null>(null);
	let loading = $state(true);
	let headings = $state<Heading[]>([]);

	// `/w/eventi` shows `eventi` if it exists, else `eventi:start`, else an index of the namespace.
	const isNamespace = $derived(pageIndex.inNamespace(requested).length > 0);
	const shownId = $derived(data?.id ?? requested);
	const listNs = $derived(
		isNamespace ? requested : noNs(shownId) === START_PAGE ? getNs(shownId) : null
	);

	$effect(() => {
		const id = requested;
		// Reload when a save of this page reaches the server (it may have been merged).
		void sync.versions[id];
		loading = true;
		(async () => {
			let p = await getPage(id);
			if (!p && !id.endsWith(`:${START_PAGE}`)) p = await getPage(`${id}:${START_PAGE}`);
			if (id !== requested) return;
			data = p;
			loading = false;
			if (location.hash) {
				await new Promise((r) => setTimeout(r, 50));
				document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
			}
		})().catch((e) => {
			loading = false;
			toast.error(e);
		});
	});

	const local = $derived(data ? sync.latest(data.id) : undefined);

	const toc = $derived(headings.filter((h) => h.level >= 2 && h.level <= 3));

	function copyLink() {
		navigator.clipboard.writeText(location.href);
		toast.show('Link copiato');
	}
</script>

<svelte:head>
	<title>{data?.title ?? nsTitle(requested)} · GRUSF Wiki</title>
</svelte:head>

<svelte:window
	onkeydown={(e) => {
		const t = e.target as HTMLElement;
		if (e.key === 'e' && !e.ctrlKey && !e.metaKey && !t.closest('input, textarea, select')) {
			e.preventDefault();
			goto(editHref(shownId));
		}
	}}
/>

<div class="page layout" class:with-toc={toc.length >= 3}>
	<div class="content">
		<div class="top">
			<Breadcrumbs id={shownId} />
			{#if data}
				<div class="tools">
					<button class="icon-btn" title="Copia link" aria-label="Copia link" onclick={copyLink}>
						<span class="icon">link</span>
					</button>
					<a class="icon-btn" title="Cronologia" aria-label="Cronologia" href={historyHref(data.id)}>
						<span class="icon">history</span>
					</a>
					<a class="btn tonal edit-top" href={editHref(data.id)}><span class="icon">edit</span> Modifica</a>
				</div>
			{/if}
		</div>

		{#if loading && !data}
			<div class="progress"></div>
		{:else if data}
			<WikiContent text={data.content} pageId={data.id} bind:headings />
			{#if local?.state === 'conflict' || local?.state === 'failed'}
				<p class="meta body-s warn">
					<span class="icon">{local.state === 'conflict' ? 'call_split' : 'error'}</span>
					<span class="grow">
						{local.state === 'conflict'
							? `Anche ${local.theirs?.by ?? 'qualcun altro'} ha modificato questi punti: scegli quale versione tenere.`
							: 'Questa modifica non è stata salvata online.'}
					</span>
					<button class="btn text" onclick={() => (sync.resolving = local.key)}>Risolvi</button>
				</p>
			{:else if local}
				<p class="meta body-s muted">
					<span class="icon">{sync.online ? 'cloud_sync' : 'cloud_off'}</span>
					{sync.online ? 'Salvataggio online in corso…' : 'Salvata su questo dispositivo: verrà inviata appena torni online.'}
				</p>
			{:else}
				<p class="meta body-s muted">
					<span class="icon">schedule</span>
					Ultima modifica {timeAgo(data.updated_at)}{data.updated_by ? ` da ${data.updated_by}` : ''} ·
					<a href={historyHref(data.id)}>cronologia</a>
				</p>
			{/if}
		{:else if !isNamespace}
			<div class="missing card outlined">
				<span class="icon">note_add</span>
				<h1 class="headline-s">Questa pagina non esiste ancora</h1>
				<p class="body-m muted"><code>{requested}</code></p>
				<a class="btn filled" href={editHref(requested)}><span class="icon">edit</span> Crea questa pagina</a>
			</div>
		{:else}
			<h1 class="headline-m">{nsTitle(requested)}</h1>
		{/if}

		{#if listNs !== null && !loading}
			<section class="ns">
				<div class="row">
					<h2 class="title-l">In questa sezione</h2>
					<span class="spacer"></span>
					<button class="btn text" onclick={() => ui.newPage(listNs)}><span class="icon">add</span> Nuova pagina</button>
				</div>
				<NamespaceList ns={listNs} exclude={shownId} />
			</section>
		{/if}
	</div>

	{#if toc.length >= 3}
		<aside class="toc">
			<p class="label-m muted">In questa pagina</p>
			{#each toc as h (h.id)}
				<a href="#{h.id}" class:sub={h.level === 3}>{h.text}</a>
			{/each}
		</aside>
	{/if}
</div>

{#if data}
	<a class="fab" href={editHref(data.id)}><span class="icon">edit</span> Modifica</a>
{/if}

<style>
	.layout.with-toc {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 220px;
		gap: 48px;
	}
	.content {
		max-width: 820px;
		min-width: 0;
	}
	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 16px;
		min-height: 40px;
	}
	.tools {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.edit-top {
		margin-left: 4px;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 40px;
		padding-top: 16px;
		border-top: 1px solid var(--md-outline-variant);
	}
	.meta .icon {
		font-size: 16px;
	}
	.meta.warn {
		color: var(--md-error);
	}
	.meta .grow {
		flex: 1;
	}
	.missing {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 48px 24px;
		text-align: center;
	}
	.missing .icon {
		font-size: 40px;
		color: var(--md-secondary);
	}
	.missing h1,
	.missing p {
		margin: 0;
	}
	.missing .btn {
		margin-top: 16px;
	}
	.missing .btn .icon {
		font-size: 18px;
		color: inherit;
	}
	.ns {
		margin-top: 40px;
	}
	.ns h2 {
		margin: 0 0 12px;
	}
	.toc {
		position: sticky;
		top: calc(var(--topbar-h) + 24px);
		align-self: start;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding-left: 16px;
		border-left: 1px solid var(--md-outline-variant);
		max-height: calc(100dvh - var(--topbar-h) - 48px);
		overflow-y: auto;
	}
	.toc p {
		margin: 0 0 8px;
	}
	.toc a {
		padding: 4px 0;
		font-size: 14px;
		color: var(--md-on-surface-variant);
		text-decoration: none;
	}
	.toc a:hover {
		color: var(--md-primary);
	}
	.toc a.sub {
		padding-left: 12px;
		font-size: 13px;
	}
	.fab {
		display: none;
	}
	@media (max-width: 1200px) {
		.layout.with-toc {
			display: block;
		}
		.toc {
			display: none;
		}
	}
	@media (max-width: 960px) {
		.fab {
			display: inline-flex;
		}
		.edit-top {
			display: none;
		}
	}
</style>
