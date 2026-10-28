<script lang="ts">
	import { page } from '$app/state';
	import {
		START_PAGE,
		extractTitle,
		getPage,
		meetingDate,
		meetingTemplate,
		noNs,
		pageHref,
		pageIndex,
		paramToId,
		saveBase,
		type SaveBase
	} from '#lib/wiki.svelte.ts';
	import { toast } from '#lib/toast.svelte.ts';
	import Editor from '#lib/components/Editor.svelte';

	const id = $derived(paramToId(page.params.id) || START_PAGE);

	let doc = $state<{ id: string; text: string; base: SaveBase; baseContent: string; isNew: boolean } | null>(null);

	$effect(() => {
		const current = id;
		const template = page.url.searchParams.get('template');
		const title = page.url.searchParams.get('title');
		doc = null;
		(async () => {
			const existing = await getPage(current);
			let text = existing?.content ?? '';
			if (!existing) {
				if (template === 'verbale') {
					if (!pageIndex.loaded) await pageIndex.load();
					text = await meetingTemplate(meetingDate(current) ?? new Date());
				} else {
					text = `====== ${title || extractTitle(current, '')} ======\n\n`;
				}
			}
			if (current === id) {
				doc = { id: current, text, base: saveBase(existing), baseContent: existing?.content ?? '', isNew: !existing };
			}
		})().catch((e) => toast.error(e));
	});

	const title = $derived(doc ? extractTitle(id, doc.text) : noNs(id));
</script>

<svelte:head><title>Modifica: {title} · GRUSF Wiki</title></svelte:head>

<div class="page edit">
	<div class="head">
		<a class="icon-btn" href={pageHref(id)} aria-label="Torna alla pagina"><span class="icon">arrow_back</span></a>
		<div class="titles">
			<h1 class="title-l">{doc?.isNew ? 'Nuova pagina' : title}</h1>
			<code class="body-s muted">{id}</code>
		</div>
	</div>
	{#if doc}
		{#key doc.id}
			<Editor
					id={doc.id}
					initial={doc.text}
					base={doc.base}
					baseContent={doc.baseContent}
					isNew={doc.isNew}
					useDraft={page.url.searchParams.has('merge')}
				/>
		{/key}
	{:else}
		<div class="progress"></div>
	{/if}
</div>

<style>
	.edit {
		max-width: 1600px;
		padding-top: 0;
		padding-bottom: 16px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 56px;
		margin-left: -8px;
	}
	.titles {
		display: flex;
		align-items: baseline;
		gap: 12px;
		min-width: 0;
	}
	h1 {
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	code {
		font-family: var(--font-mono);
		white-space: nowrap;
	}
	@media (max-width: 600px) {
		.edit {
			padding: 0 8px 8px;
		}
		.head {
			margin-left: 0;
		}
		code {
			display: none;
		}
	}
</style>
