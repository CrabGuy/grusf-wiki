<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		MEETINGS_NS,
		START_PAGE,
		editHref,
		formatDate,
		meetingId,
		pageHref,
		pageIndex,
		search,
		timeAgo,
		todaysMeeting
	} from '#lib/wiki.svelte.ts';
	import { ui } from '#lib/ui.svelte.ts';
	import Dialog from '#lib/components/Dialog.svelte';

	let q = $state('');
	let hits = $state<Map<string, string> | null>(null);
	let dateOpen = $state(false);
	let date = $state(new Date().toISOString().slice(0, 10));

	const today = $derived(pageIndex.loaded ? todaysMeeting() : undefined);

	// Full-text search restricted to meetings (debounced).
	$effect(() => {
		const query = q.trim();
		if (query.length < 3) {
			hits = null;
			return;
		}
		const t = setTimeout(async () => {
			const res = await search(query);
			hits = new Map(res.filter((r) => r.id.startsWith(`${MEETINGS_NS}:`)).map((r) => [r.id, r.snippet]));
		}, 250);
		return () => clearTimeout(t);
	});

	const filtered = $derived.by(() => {
		const n = q.trim().toLowerCase();
		return pageIndex.meetings.filter(
			(m) => !n || m.title.toLowerCase().includes(n) || m.id.includes(n) || hits?.has(m.id)
		);
	});

	const byYear = $derived.by(() => {
		const groups = new Map<string, typeof filtered>();
		for (const m of filtered) {
			const y = m.date ? String(m.date.getFullYear()) : 'Senza data';
			groups.set(y, [...(groups.get(y) ?? []), m]);
		}
		return [...groups];
	});

	function snippet(s: string) {
		const esc = s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
		return esc.replace(/⟦/g, '<mark>').replace(/⟧/g, '</mark>');
	}

	function createForDate() {
		dateOpen = false;
		const [y, m, d] = date.split('-').map(Number);
		goto(editHref(meetingId(new Date(y, m - 1, d)), '?template=verbale'));
	}
</script>

<svelte:head><title>Verbali · GRUSF Wiki</title></svelte:head>

<div class="page narrow">
	<header class="head">
		<div>
			<h1 class="headline-m">Verbali</h1>
			<p class="body-m muted">
				Riunioni e assemblee, dalla più recente.
				{#if pageIndex.exists(`${MEETINGS_NS}:${START_PAGE}`)}
					<a href={pageHref(`${MEETINGS_NS}:${START_PAGE}`)}>Come si scrive un verbale</a>
				{/if}
			</p>
		</div>
		<div class="actions">
			<button class="btn outlined" onclick={() => (dateOpen = true)}><span class="icon">calendar_month</span> Altra data</button>
			<button class="btn filled" onclick={() => ui.meetingToday()}>
				<span class="icon">{today ? 'edit_note' : 'add'}</span>
				{today ? 'Continua quello di oggi' : 'Nuovo verbale'}
			</button>
		</div>
	</header>

	<div class="filter">
		<span class="icon">filter_list</span>
		<input bind:value={q} type="search" placeholder="Cerca nei verbali (es. castagnata, budget, Giulia…)" aria-label="Cerca nei verbali" />
	</div>

	{#each byYear as [year, items] (year)}
		<h2 class="title-s year">{year}</h2>
		<ul class="list meetings">
			{#each items as m (m.id)}
				<li>
					<a class="list-item" href={pageHref(m.id)}>
						<span class="date-chip">
							{#if m.date}
								<span class="d">{m.date.getDate()}</span>
								<span class="m">{m.date.toLocaleDateString('it-IT', { month: 'short' })}</span>
							{:else}
								<span class="icon">description</span>
							{/if}
						</span>
						<span class="grow">
							<span class="headline">{m.title}</span>
							{#if hits?.get(m.id)}
								<!-- eslint-disable-next-line svelte/no-at-html-tags -- escaped above -->
								<span class="supporting snippet">{@html snippet(hits.get(m.id)!)}</span>
							{:else}
								<span class="supporting">
									{m.date ? formatDate(m.date) : m.id} · modificato {timeAgo(m.updated_at)}{m.updated_by ? ` da ${m.updated_by}` : ''}
								</span>
							{/if}
						</span>
					</a>
					<a class="icon-btn edit" href={editHref(m.id)} title="Modifica" aria-label="Modifica {m.title}">
						<span class="icon">edit</span>
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<div class="empty card outlined">
			<span class="icon">event_note</span>
			<p class="body-l">{q ? 'Nessun verbale trovato.' : 'Ancora nessun verbale.'}</p>
		</div>
	{/each}
</div>

<button class="fab" onclick={() => ui.meetingToday()}>
	<span class="icon">{today ? 'edit_note' : 'add'}</span> {today ? 'Oggi' : 'Nuovo verbale'}
</button>

<Dialog bind:open={dateOpen} title="Verbale di un altro giorno" icon="calendar_month">
	<div class="field">
		<label for="mdate">Data della riunione</label>
		<input id="mdate" type="date" bind:value={date} />
	</div>
	{#snippet actions()}
		<button class="btn text" onclick={() => (dateOpen = false)}>Annulla</button>
		<button class="btn filled" onclick={createForDate} disabled={!date}>Crea</button>
	{/snippet}
</Dialog>

<style>
	.narrow {
		max-width: 880px;
	}
	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 16px;
		margin-bottom: 24px;
	}
	h1 {
		margin: 8px 0 4px;
	}
	.head p {
		margin: 0;
	}
	.actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.filter {
		display: flex;
		align-items: center;
		gap: 12px;
		height: 48px;
		padding: 0 16px;
		border-radius: var(--md-shape-full);
		background: var(--md-surface-container);
		color: var(--md-on-surface-variant);
	}
	.filter input {
		flex: 1;
		height: 100%;
		border: none;
		background: transparent;
		font: inherit;
		color: var(--md-on-surface);
	}
	.filter input:focus {
		outline: none;
	}
	.year {
		margin: 28px 0 8px 4px;
		color: var(--md-primary);
	}
	.meetings {
		border-radius: var(--md-shape-lg);
		background: var(--md-surface-container-low);
		overflow: hidden;
	}
	.meetings li {
		position: relative;
	}
	.meetings li + li {
		border-top: 1px solid var(--md-outline-variant);
	}
	.list-item {
		min-height: 72px;
		padding-right: 64px;
	}
	.edit {
		position: absolute;
		right: 12px;
		top: 50%;
		transform: translateY(-50%);
	}
	.date-chip {
		width: 48px;
		height: 48px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		border-radius: var(--md-shape-md);
		background: var(--md-tertiary-container);
		color: var(--md-on-tertiary-container);
		line-height: 1;
	}
	.date-chip .d {
		font-size: 18px;
		font-weight: 600;
	}
	.date-chip .m {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}
	.date-chip .icon {
		color: inherit;
	}
	.snippet {
		white-space: normal;
	}
	.snippet :global(mark) {
		background: var(--md-warning-container);
		color: inherit;
		border-radius: 2px;
		padding: 0 2px;
	}
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 48px;
		margin-top: 24px;
		color: var(--md-on-surface-variant);
	}
	.empty .icon {
		font-size: 40px;
	}
	@media (min-width: 961px) {
		.fab {
			display: none;
		}
	}
	@media (max-width: 600px) {
		.actions {
			display: none;
		}
	}
</style>
