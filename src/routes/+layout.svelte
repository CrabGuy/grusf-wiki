<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';
	import { page } from '$app/state';
	import { afterNavigate, preloadCode } from '$app/navigation';
	import { configured } from '#lib/supabase.ts';
	import { session } from '#lib/session.svelte.ts';
	import { sync } from '#lib/sync.svelte.ts';
	import { MEETINGS_NS, href, nsTitle, pageHref, pageIndex } from '#lib/wiki.svelte.ts';
	import { toast } from '#lib/toast.svelte.ts';
	import { ui } from '#lib/ui.svelte.ts';
	import Login from '#lib/components/Login.svelte';
	import Snackbar from '#lib/components/Snackbar.svelte';
	import SearchBar from '#lib/components/SearchBar.svelte';
	import NewPageDialog from '#lib/components/NewPageDialog.svelte';
	import SyncStatus from '#lib/components/SyncStatus.svelte';

	let { children }: LayoutProps = $props();
	let menuOpen = $state(false);

	const NS_ICONS: Record<string, string> = {
		eventi: 'celebration',
		associazione: 'groups',
		wiki: 'help',
		progetti: 'rocket_launch',
		formazione: 'school'
	};

	session.init();

	$effect(() => {
		if (session.user && !pageIndex.loaded) pageIndex.load().catch((e) => toast.error(e));
	});

	// Send saves made while offline (or in a tab that was closed too early).
	$effect(() => {
		if (!session.user) return;
		sync.start(session.user.id);
		// Load every screen's code now, so the wiki keeps working if the connection drops
		// (e.g. writing the verbale in a room with bad signal).
		const routes = ['/', '/verbali', '/w/[...id]', '/edit/[...id]', '/history/[...id]', '/recent', '/search', '/index', '/account'] as const;
		const timer = setTimeout(() => routes.forEach((r) => preloadCode(r).catch(() => {})), 1000);
		return () => clearTimeout(timer);
	});

	function logout() {
		const n = sync.entries.length;
		if (n && !confirm(`${n === 1 ? 'Una modifica non è ancora online' : `${n} modifiche non sono ancora online`}. Restano su questo dispositivo e verranno inviate al prossimo accesso. Uscire comunque?`)) return;
		session.logout();
	}

	afterNavigate(() => {
		ui.drawerOpen = false;
		menuOpen = false;
	});

	const path = $derived(page.url.pathname);
	const isActive = (p: string) => (p === href('/') ? path === p : path === p || path.startsWith(p + '/'));
	const sections = $derived(pageIndex.namespaces.filter((n) => n !== MEETINGS_NS));
	const initials = $derived(
		session.name
			.split(/[\s.]+/)
			.map((w) => w[0])
			.join('')
			.slice(0, 2)
			.toUpperCase()
	);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if !configured}
	<main class="center-screen">
		<div class="card outlined setup">
			<span class="icon">settings</span>
			<h1 class="title-l">Configurazione mancante</h1>
			<p class="body-m">
				Crea un file <code>.env</code> con <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> (vedi
				<code>.env.example</code> e il README).
			</p>
		</div>
	</main>
{:else if !session.ready}
	<main class="center-screen"><div class="spinner" aria-label="Caricamento"></div></main>
{:else if !session.user}
	<Login />
{:else}
	<div class="shell">
		<nav class="drawer" class:open={ui.drawerOpen} aria-label="Navigazione">
			<a class="brand" href={href('/')}>
				<span class="mark"><span class="icon filled">menu_book</span></span>
				<span>
					<span class="title-m">GRUSF Wiki</span>
					<span class="body-s muted">Gruppo Universitari San Frediano</span>
				</span>
			</a>

			<button class="btn tonal new" onclick={() => ui.newPage()}>
				<span class="icon">edit_square</span> Nuova pagina
			</button>

			<a class="nav-item" class:active={isActive(href('/'))} href={href('/')}>
				<span class="icon" class:filled={isActive(href('/'))}>home</span> Home
			</a>
			<div class="nav-row">
				<a class="nav-item" class:active={isActive(href('/verbali'))} href={href('/verbali')}>
					<span class="icon" class:filled={isActive(href('/verbali'))}>event_note</span> Verbali
				</a>
				<button class="icon-btn add" title="Nuovo verbale" aria-label="Nuovo verbale" onclick={() => ui.newMeeting()}>
					<span class="icon">add</span>
				</button>
			</div>

			{#if sections.length}
				<p class="nav-label label-m">Sezioni</p>
				{#each sections as ns (ns)}
					{@const p = pageHref(ns)}
					<a class="nav-item" class:active={isActive(p)} href={p} title={nsTitle(ns)}>
						<span class="icon" class:filled={isActive(p)}>{NS_ICONS[ns] ?? 'folder'}</span>
						<span class="label">{nsTitle(ns)}</span>
					</a>
				{/each}
			{/if}

			<hr class="divider" />
			<a class="nav-item" class:active={isActive(href('/index'))} href={href('/index')}>
				<span class="icon">account_tree</span> Tutte le pagine
			</a>
			<a class="nav-item" class:active={isActive(href('/recent'))} href={href('/recent')}>
				<span class="icon">history</span> Modifiche recenti
			</a>
			{#if session.isAdmin}
				<a class="nav-item" class:active={isActive(href('/admin'))} href={href('/admin')}>
					<span class="icon" class:filled={isActive(href('/admin'))}>admin_panel_settings</span> Utenti
				</a>
			{/if}
		</nav>
		<button
			class="scrim"
			class:open={ui.drawerOpen}
			aria-label="Chiudi menu"
			tabindex="-1"
			onclick={() => (ui.drawerOpen = false)}
		></button>

		<div class="main">
			<header class="topbar">
				<button class="icon-btn menu" aria-label="Menu" onclick={() => (ui.drawerOpen = true)}>
					<span class="icon">menu</span>
				</button>
				<SearchBar />
				<SyncStatus />
				<div class="account">
					<button class="avatar" aria-label="Account" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>
						{initials || '?'}
					</button>
					{#if menuOpen}
						<button class="menu-scrim" aria-label="Chiudi" tabindex="-1" onclick={() => (menuOpen = false)}></button>
						<div class="menu-card" role="menu">
							<div class="who">
								<span class="title-s">{session.name}</span>
								<span class="body-s muted">@{session.profile?.username}{session.isAdmin ? ' · amministratore' : ''}</span>
							</div>
							<a class="list-item" role="menuitem" href={href('/account')}>
								<span class="icon">key</span> Cambia password
							</a>
							<button class="list-item" role="menuitem" onclick={logout}>
								<span class="icon">logout</span> Esci
							</button>
						</div>
					{/if}
				</div>
			</header>
			{@render children()}
		</div>
	</div>
	<NewPageDialog bind:open={ui.newPageOpen} ns={ui.newPageNs} />
{/if}

<Snackbar />

<style>
	.center-screen {
		min-height: 100dvh;
		display: grid;
		place-items: center;
		padding: 16px;
	}
	.setup {
		max-width: 480px;
		text-align: center;
	}
	.setup .icon {
		font-size: 40px;
		color: var(--md-secondary);
	}

	.shell {
		min-height: 100dvh;
	}
	.drawer {
		position: fixed;
		inset: 0 auto 0 0;
		width: var(--drawer-w);
		z-index: 40;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 12px;
		overflow-y: auto;
		background: var(--md-surface-container-low);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 12px 16px;
		color: inherit;
		text-decoration: none;
	}
	.brand > span:last-child {
		display: flex;
		flex-direction: column;
	}
	.mark {
		width: 40px;
		height: 40px;
		display: grid;
		place-items: center;
		border-radius: var(--md-shape-md);
		background: var(--md-primary);
		color: var(--md-on-primary);
	}
	.new {
		justify-content: flex-start;
		height: 56px;
		margin: 0 0 12px;
		padding: 0 20px;
		border-radius: var(--md-shape-lg);
		background: var(--md-primary-container);
		color: var(--md-on-primary-container);
	}
	.new .icon {
		margin-left: 0;
		font-size: 24px;
	}
	.nav-item {
		display: flex;
		align-items: center;
		gap: 12px;
		height: 56px;
		padding: 0 16px;
		border-radius: var(--md-shape-full);
		color: var(--md-on-surface-variant);
		font-size: 14px;
		font-weight: 500;
		text-decoration: none;
		position: relative;
		overflow: hidden;
		isolation: isolate;
	}
	.nav-item::after {
		content: '';
		position: absolute;
		inset: 0;
		background: var(--md-on-surface);
		opacity: 0;
		transition: opacity 150ms var(--md-ease);
		z-index: -1;
	}
	.nav-item:hover::after {
		opacity: 0.06;
	}
	.nav-item .label {
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.nav-item.active {
		background: var(--md-secondary-container);
		color: var(--md-on-secondary-container);
	}
	.nav-row {
		position: relative;
		display: flex;
		align-items: center;
	}
	.nav-row .nav-item {
		flex: 1;
	}
	.nav-row .add {
		position: absolute;
		right: 8px;
	}
	.nav-label {
		margin: 16px 16px 4px;
		color: var(--md-on-surface-variant);
	}
	.drawer .divider {
		margin: 12px 16px;
	}
	.scrim {
		display: none;
	}

	.main {
		margin-left: var(--drawer-w);
		min-width: 0;
	}
	.topbar {
		position: sticky;
		top: 0;
		z-index: 20;
		height: var(--topbar-h);
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 0 24px;
		background: color-mix(in srgb, var(--md-surface) 88%, transparent);
		backdrop-filter: blur(12px);
	}
	.menu {
		display: none;
	}
	/* Search on the left, sync status and account pushed to the right. */
	.topbar :global(.search) {
		margin-right: auto;
	}
	.account {
		position: relative;
	}
	.avatar {
		width: 40px;
		height: 40px;
		border: none;
		border-radius: 50%;
		background: var(--md-tertiary-container);
		color: var(--md-on-tertiary-container);
		font: inherit;
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
	}
	.menu-scrim {
		position: fixed;
		inset: 0;
		z-index: 49;
		border: none;
		background: transparent;
	}
	.menu-card {
		position: absolute;
		right: 0;
		top: 48px;
		z-index: 50;
		min-width: 240px;
		padding: 8px 0;
		border-radius: var(--md-shape-sm);
		background: var(--md-surface-container);
		box-shadow: var(--md-elev-2);
	}
	.who {
		display: flex;
		flex-direction: column;
		padding: 8px 16px 12px;
		border-bottom: 1px solid var(--md-outline-variant);
		margin-bottom: 8px;
	}
	.menu-card .list-item {
		min-height: 48px;
		font-size: 14px;
	}

	@media (max-width: 960px) {
		.drawer {
			transform: translateX(-100%);
			transition: transform 300ms var(--md-ease-emphasized);
			border-radius: 0 var(--md-shape-lg) var(--md-shape-lg) 0;
			box-shadow: var(--md-elev-3);
			width: min(var(--drawer-w), 85vw);
			background: var(--md-surface-container-low);
		}
		.drawer.open {
			transform: none;
		}
		.scrim {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 39;
			border: none;
			background: var(--md-scrim);
			opacity: 0;
			pointer-events: none;
			transition: opacity 300ms var(--md-ease);
		}
		.scrim.open {
			opacity: 1;
			pointer-events: auto;
		}
		.main {
			margin-left: 0;
		}
		.menu {
			display: inline-grid;
		}
		.topbar {
			padding: 0 8px 0 4px;
			gap: 4px;
		}
	}
</style>
