<script lang="ts">
	import { session } from '#lib/session.svelte.ts';
	import { ui } from '#lib/ui.svelte.ts';
	import {
		START_PAGE,
		MEETINGS_NS,
		formatDate,
		getPage,
		href,
		nsTitle,
		pageHref,
		pageIndex,
		timeAgo,
		todaysMeeting,
		type Page
	} from '#lib/wiki.svelte.ts';
	import WikiContent from '#lib/components/WikiContent.svelte';

	const NS_ICONS: Record<string, string> = { eventi: 'celebration', associazione: 'groups', wiki: 'help' };

	let start = $state<Page | null>(null);
	$effect(() => {
		if (pageIndex.loaded) getPage(START_PAGE).then((p) => (start = p));
	});

	const today = $derived(pageIndex.loaded ? todaysMeeting() : undefined);
	const meetings = $derived(pageIndex.meetings.slice(0, 4));
	const recent = $derived(pageIndex.recent.slice(0, 6));
	const sections = $derived(
		pageIndex.namespaces
			.filter((n) => n !== MEETINGS_NS)
			.map((ns) => ({ ns, count: pageIndex.inNamespace(ns).length }))
	);
	const hour = new Date().getHours();
	const greeting = hour < 13 ? 'Buongiorno' : hour < 18 ? 'Buon pomeriggio' : 'Buonasera';
</script>

<svelte:head><title>GRUSF Wiki</title></svelte:head>

<div class="page">
	<h1 class="headline-m greet">{greeting}, {session.name.split(' ')[0]}</h1>

	<section class="hero">
		<div class="hero-text">
			<span class="label-l eyebrow"><span class="icon">event_note</span> Verbali</span>
			<h2 class="headline-s">{today ? 'Il verbale di oggi è già iniziato' : 'C’è una riunione oggi?'}</h2>
			<p class="body-m">
				{#if today}
					Riprendi da dove eri rimasto: le modifiche di tutti finiscono nella stessa pagina.
				{:else}
					Il verbale si crea già impostato, con i presenti e le cose da fare della riunione precedente.
				{/if}
			</p>
		</div>
		<div class="hero-actions">
			<button class="btn filled big" onclick={() => ui.meetingToday()}>
				<span class="icon">{today ? 'edit_note' : 'add'}</span>
				{today ? 'Continua il verbale' : 'Scrivi il verbale di oggi'}
			</button>
			<a class="btn text" href={href('/verbali')}>Tutti i verbali</a>
		</div>
	</section>

	<div class="grid">
		<section class="card">
			<header class="row">
				<h2 class="title-m">Ultimi verbali</h2>
				<span class="spacer"></span>
				<a class="btn text" href={href('/verbali')}>Vedi tutti</a>
			</header>
			<ul class="list">
				{#each meetings as m (m.id)}
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
								<span class="supporting">{m.date ? formatDate(m.date) : m.id}</span>
							</span>
						</a>
					</li>
				{:else}
					<li class="empty body-m muted">Ancora nessun verbale.</li>
				{/each}
			</ul>
		</section>

		<section class="card">
			<header class="row">
				<h2 class="title-m">Modificate di recente</h2>
				<span class="spacer"></span>
				<a class="btn text" href={href('/recent')}>Cronologia</a>
			</header>
			<ul class="list">
				{#each recent as p (p.id)}
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
		</section>
	</div>

	{#if sections.length}
		<h2 class="title-l section-title">Sezioni</h2>
		<div class="sections">
			{#each sections as s (s.ns)}
				<a class="card outlined section" href={pageHref(s.ns)}>
					<span class="icon sec-icon">{NS_ICONS[s.ns] ?? 'folder'}</span>
					<span class="title-m">{nsTitle(s.ns)}</span>
					<span class="body-s muted">{s.count} {s.count === 1 ? 'pagina' : 'pagine'}</span>
				</a>
			{/each}
		</div>
	{/if}

	{#if start}
		<section class="card start">
			<WikiContent text={start.content} pageId={START_PAGE} />
			<a class="btn text" href={pageHref(START_PAGE)}><span class="icon">open_in_full</span> Apri la pagina</a>
		</section>
	{/if}
</div>

<button class="fab" onclick={() => ui.meetingToday()}>
	<span class="icon">edit_note</span> Verbale di oggi
</button>

<style>
	.greet {
		margin: 8px 0 24px;
	}
	.hero {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 24px;
		padding: 28px;
		border-radius: var(--md-shape-xl);
		background:
			radial-gradient(circle at 100% 0%, color-mix(in srgb, var(--md-tertiary-container) 90%, transparent) 0, transparent 55%),
			var(--md-primary-container);
		color: var(--md-on-primary-container);
	}
	.hero-text {
		max-width: 560px;
	}
	.hero h2 {
		margin: 8px 0;
	}
	.hero p {
		margin: 0;
		opacity: 0.85;
	}
	.eyebrow {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.eyebrow .icon {
		font-size: 18px;
	}
	.hero-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.hero .btn.text {
		color: var(--md-on-primary-container);
	}
	.big {
		height: 56px;
		padding: 0 28px;
		font-size: 16px;
		border-radius: var(--md-shape-lg);
	}
	.big .icon {
		font-size: 22px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
		gap: 16px;
		margin-top: 24px;
	}
	.grid .card {
		padding: 8px 0;
	}
	.grid header {
		padding: 8px 8px 4px 16px;
	}
	.grid h2 {
		margin: 0;
	}
	.date-chip {
		width: 44px;
		height: 44px;
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
		font-size: 17px;
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
	.empty {
		padding: 16px;
	}
	.section-title {
		margin: 32px 0 12px;
	}
	.sections {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 12px;
	}
	.section {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 20px;
	}
	.sec-icon {
		color: var(--md-primary);
		margin-bottom: 8px;
	}
	.start {
		margin-top: 32px;
		padding: 24px 28px;
		background: var(--md-surface-container-lowest);
	}
	.start .btn {
		margin-top: 4px;
		margin-left: -12px;
	}
	@media (max-width: 600px) {
		.hero {
			padding: 20px;
		}
		.start {
			padding: 16px;
		}
	}
	@media (min-width: 961px) {
		.fab {
			display: none;
		}
	}
</style>
