<script lang="ts">
	import { goto } from '$app/navigation';
	import Dialog from './Dialog.svelte';
	import { cleanId, editHref, pageHref, pageIndex, nsTitle } from '#lib/wiki.svelte.ts';

	let { open = $bindable(false), ns = '' }: { open: boolean; ns?: string } = $props();

	let title = $state('');
	let section = $state('');

	$effect(() => {
		if (open) {
			title = '';
			section = ns;
		}
	});

	const id = $derived(cleanId([cleanId(section), cleanId(title)].filter(Boolean).join(':')));
	const exists = $derived(pageIndex.exists(id));

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!id || !title.trim()) return;
		open = false;
		goto(exists ? pageHref(id) : editHref(id, `?title=${encodeURIComponent(title.trim())}`));
	}
</script>

<Dialog bind:open title="Nuova pagina" icon="note_add">
	<form id="newpage" class="stack" onsubmit={submit}>
		<div class="field">
			<label for="np-title">Titolo</label>
			<!-- svelte-ignore a11y_autofocus -->
			<input id="np-title" bind:value={title} placeholder="Es. Cena di Natale 2026" required autofocus />
		</div>
		<div class="field">
			<label for="np-ns">Sezione</label>
			<input id="np-ns" bind:value={section} list="np-ns-list" placeholder="Es. eventi:archivio (vuoto = principale)" />
			<datalist id="np-ns-list">
				{#each pageIndex.allNamespaces as n (n)}
					<option value={n}>{nsTitle(n)}</option>
				{/each}
			</datalist>
			<span class="supporting">Scegline una esistente o scrivi un nome nuovo per creare una sezione.</span>
		</div>
		{#if id}
			<p class="body-s preview">
				<span class="icon">link</span>
				<code>{id}</code>
				{#if exists}<span class="badge">esiste già: la apro</span>{/if}
			</p>
		{/if}
	</form>
	{#snippet actions()}
		<button class="btn text" onclick={() => (open = false)}>Annulla</button>
		<button class="btn filled" form="newpage" type="submit" disabled={!title.trim()}>
			{exists ? 'Apri' : 'Crea e modifica'}
		</button>
	{/snippet}
</Dialog>

<style>
	.preview {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
	}
	.preview .icon {
		font-size: 18px;
	}
	code {
		font-family: var(--font-mono);
	}
</style>
