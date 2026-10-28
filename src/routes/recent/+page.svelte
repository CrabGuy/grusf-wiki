<script lang="ts">
	import { formatRev, historyHref, pageHref, pageIndex, recentChanges, type ChangeRow } from '#lib/wiki.svelte.ts';
	import { toast } from '#lib/toast.svelte.ts';

	const PAGE = 50;
	let changes = $state<ChangeRow[]>([]);
	let more = $state(true);
	let loading = $state(false);

	async function load() {
		loading = true;
		try {
			const rows = await recentChanges(PAGE, changes.length);
			changes = [...changes, ...rows];
			more = rows.length === PAGE;
		} catch (e) {
			toast.error(e);
		} finally {
			loading = false;
		}
	}
	load();

	const ICON: Record<string, string> = { C: 'add_circle', E: 'edit', e: 'edit_note', D: 'delete', R: 'restore' };
	const LABEL: Record<string, string> = { C: 'creata', E: 'modificata', e: 'modifica minore', D: 'eliminata', R: 'ripristinata' };

	const byDay = $derived.by(() => {
		const fmt = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
		const groups = new Map<string, ChangeRow[]>();
		for (const c of changes) {
			const day = fmt.format(new Date(c.rev * 1000));
			groups.set(day, [...(groups.get(day) ?? []), c]);
		}
		return [...groups];
	});
</script>

<svelte:head><title>Modifiche recenti · GRUSF Wiki</title></svelte:head>

<div class="page narrow">
	<h1 class="headline-m">Modifiche recenti</h1>

	{#each byDay as [day, items] (day)}
		<h2 class="title-s day">{day}</h2>
		<ul class="list card">
			{#each items as c (c.page_id + c.rev)}
				{@const title = pageIndex.get(c.page_id)?.title ?? c.page_id}
				<li>
					<a class="list-item" href={c.type === 'D' ? historyHref(c.page_id) : pageHref(c.page_id)}>
						<span class="icon">{ICON[c.type] ?? 'edit'}</span>
						<span class="grow">
							<span class="headline">{title}</span>
							<span class="supporting">
								{formatRev(c.rev).split(', ').pop()} · {c.username ?? '?'} · {c.summary || LABEL[c.type]}
							</span>
						</span>
						<span class="body-s" class:plus={c.size_change > 0} class:minus={c.size_change < 0}>
							{c.size_change > 0 ? '+' : ''}{c.size_change}
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{/each}

	{#if loading}
		<div class="progress"></div>
	{:else if more}
		<button class="btn outlined more" onclick={load}>Carica altre</button>
	{/if}
</div>

<style>
	.narrow {
		max-width: 820px;
	}
	.day {
		margin: 24px 0 8px 4px;
		color: var(--md-primary);
		text-transform: capitalize;
	}
	.card {
		padding: 4px 0;
	}
	.plus {
		color: var(--rp-pine);
	}
	.minus {
		color: var(--md-error);
	}
	.more {
		margin-top: 24px;
	}
</style>
