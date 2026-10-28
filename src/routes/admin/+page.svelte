<script lang="ts">
	import { callFunction } from '#lib/supabase.ts';
	import { session } from '#lib/session.svelte.ts';
	import { toast } from '#lib/toast.svelte.ts';
	import { href, pageIndex, timeAgo } from '#lib/wiki.svelte.ts';
	import Dialog from '#lib/components/Dialog.svelte';

	interface User {
		id: string;
		username: string;
		display_name: string;
		role: 'admin' | 'user';
		created_at: string;
		last_sign_in_at: string | null;
	}
	interface Credential {
		username: string;
		display_name: string;
		password: string;
	}

	let users = $state<User[]>([]);
	let loading = $state(true);
	let names = $state('');
	let creating = $state(false);
	let credentials = $state<Credential[]>([]);
	let credOpen = $state(false);
	let confirmDelete = $state<User | null>(null);
	let menuFor = $state<string | null>(null);
	let reindexing = $state(false);
	let filter = $state('');

	async function load() {
		try {
			const res = await callFunction<{ users: User[] }>('admin', { action: 'list' });
			users = res.users;
		} catch (e) {
			toast.error(e);
		} finally {
			loading = false;
		}
	}
	if (session.isAdmin) load();

	const siteUrl = $derived(location.origin + href('/'));

	function message(c: Credential) {
		const first = c.display_name.split(' ')[0];
		return [
			`Ciao ${first}! Ecco il tuo accesso al wiki del GRUSF:`,
			`🔗 ${siteUrl}`,
			`👤 Nome utente: ${c.username}`,
			`🔑 Password: ${c.password}`,
			`Se vuoi puoi cambiare la password dal menu in alto a destra.`
		].join('\n');
	}

	async function copy(text: string, what = 'Messaggio copiato') {
		await navigator.clipboard.writeText(text);
		toast.show(what);
	}

	async function create(e: SubmitEvent) {
		e.preventDefault();
		const list = names
			.split(/[\n,;]+/)
			.map((n) => n.trim())
			.filter(Boolean);
		if (!list.length) return;
		creating = true;
		try {
			const res = await callFunction<{ created: Credential[]; errors: { name: string; error: string }[] }>('admin', {
				action: 'create',
				names: list
			});
			for (const err of res.errors) toast.show(`${err.name}: ${err.error}`, { error: true });
			if (res.created.length) {
				credentials = res.created;
				credOpen = true;
				names = '';
				load();
			}
		} catch (err) {
			toast.error(err);
		} finally {
			creating = false;
		}
	}

	async function resetPassword(u: User) {
		menuFor = null;
		try {
			const res = await callFunction<Credential>('admin', { action: 'reset_password', id: u.id });
			credentials = [res];
			credOpen = true;
		} catch (e) {
			toast.error(e);
		}
	}

	async function setRole(u: User, role: 'admin' | 'user') {
		menuFor = null;
		try {
			await callFunction('admin', { action: 'set_role', id: u.id, role });
			toast.show(role === 'admin' ? `${u.display_name} ora è amministratore` : `${u.display_name} non è più amministratore`);
			load();
		} catch (e) {
			toast.error(e);
		}
	}

	async function remove() {
		const u = confirmDelete;
		confirmDelete = null;
		if (!u) return;
		try {
			await callFunction('admin', { action: 'delete', id: u.id });
			toast.show(`Account di ${u.display_name} eliminato`);
			load();
		} catch (e) {
			toast.error(e);
		}
	}

	async function reindex() {
		reindexing = true;
		try {
			const res = await callFunction<{ pages: number; changes: number }>('admin', { action: 'reindex' });
			await pageIndex.load();
			toast.show(`Indice ricostruito: ${res.pages} pagine, ${res.changes} modifiche`);
		} catch (e) {
			toast.error(e);
		} finally {
			reindexing = false;
		}
	}

	const shown = $derived(
		users.filter((u) => !filter || `${u.display_name} ${u.username}`.toLowerCase().includes(filter.toLowerCase()))
	);
	const initials = (n: string) =>
		n
			.split(/[\s.]+/)
			.map((w) => w[0])
			.join('')
			.slice(0, 2)
			.toUpperCase();
</script>

<svelte:head><title>Utenti · GRUSF Wiki</title></svelte:head>

<div class="page narrow">
	{#if !session.isAdmin}
		<div class="card outlined body-m">Questa pagina è riservata agli amministratori.</div>
	{:else}
		<h1 class="headline-m">Utenti</h1>

		<form class="card add" onsubmit={create}>
			<div class="row">
				<span class="icon accent">person_add</span>
				<h2 class="title-m">Aggiungi persone</h2>
			</div>
			<p class="body-m muted">
				Scrivi nome e cognome, uno per riga. Nome utente e password vengono creati in automatico e ti preparo un
				messaggio da incollare su WhatsApp.
			</p>
			<div class="field">
				<textarea bind:value={names} rows="3" placeholder={'Mario Rossi\nGiulia Bianchi'} aria-label="Nomi"></textarea>
			</div>
			<div class="row">
				<span class="spacer"></span>
				<button class="btn filled" type="submit" disabled={creating || !names.trim()}>
					<span class="icon">group_add</span>
					{creating ? 'Creazione…' : 'Crea account'}
				</button>
			</div>
		</form>

		<div class="row list-head">
			<h2 class="title-l">{users.length} {users.length === 1 ? 'persona' : 'persone'}</h2>
			<span class="spacer"></span>
			{#if users.length > 8}
				<input class="filter" bind:value={filter} placeholder="Filtra" aria-label="Filtra utenti" />
			{/if}
		</div>

		{#if loading}
			<div class="progress"></div>
		{:else}
			<ul class="list users">
				{#each shown as u (u.id)}
					<li>
						<div class="list-item">
							<span class="avatar" class:admin={u.role === 'admin'}>{initials(u.display_name || u.username)}</span>
							<span class="grow">
								<span class="headline">
									{u.display_name || u.username}
									{#if u.role === 'admin'}<span class="badge">admin</span>{/if}
									{#if u.id === session.user?.id}<span class="badge you">tu</span>{/if}
								</span>
								<span class="supporting">
									@{u.username} · {u.last_sign_in_at ? `ultimo accesso ${timeAgo(u.last_sign_in_at)}` : 'mai entrato'}
								</span>
							</span>
							<div class="menu-wrap">
								<button class="icon-btn" aria-label="Azioni per {u.display_name}" onclick={() => (menuFor = menuFor === u.id ? null : u.id)}>
									<span class="icon">more_vert</span>
								</button>
								{#if menuFor === u.id}
									<button class="menu-scrim" aria-label="Chiudi" tabindex="-1" onclick={() => (menuFor = null)}></button>
									<div class="menu" role="menu">
										<button class="list-item" role="menuitem" onclick={() => resetPassword(u)}>
											<span class="icon">lock_reset</span> Nuova password
										</button>
										{#if u.role === 'admin'}
											<button class="list-item" role="menuitem" onclick={() => setRole(u, 'user')}>
												<span class="icon">remove_moderator</span> Togli amministratore
											</button>
										{:else}
											<button class="list-item" role="menuitem" onclick={() => setRole(u, 'admin')}>
												<span class="icon">shield_person</span> Rendi amministratore
											</button>
										{/if}
										{#if u.id !== session.user?.id}
											<button class="list-item danger" role="menuitem" onclick={() => { menuFor = null; confirmDelete = u; }}>
												<span class="icon">person_remove</span> Elimina account
											</button>
										{/if}
									</div>
								{/if}
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		<section class="card outlined maint">
			<div class="row">
				<span class="icon accent">build</span>
				<h2 class="title-m">Manutenzione</h2>
			</div>
			<p class="body-m muted">
				Se hai caricato file DokuWiki direttamente nello Storage di Supabase (cartelle <code>pages/</code>,
				<code>media/</code>, <code>attic/</code>, <code>meta/</code>), ricostruisci l'indice per farli comparire nel wiki.
			</p>
			<button class="btn outlined" onclick={reindex} disabled={reindexing}>
				<span class="icon">sync</span>
				{reindexing ? 'Ricostruzione…' : "Ricostruisci l'indice"}
			</button>
		</section>
	{/if}
</div>

<Dialog bind:open={credOpen} title={credentials.length > 1 ? 'Account pronti' : 'Credenziali pronte'} icon="key" wide>
	<p>Invia a ciascuno il suo messaggio. Le password non vengono salvate da nessuna parte: copiale ora (puoi sempre generarne una nuova).</p>
	<div class="creds">
		{#each credentials as c (c.username)}
			<div class="cred">
				<pre>{message(c)}</pre>
				<button class="btn tonal" onclick={() => copy(message(c), `Messaggio per ${c.display_name} copiato`)}>
					<span class="icon">content_copy</span> Copia
				</button>
			</div>
		{/each}
	</div>
	{#snippet actions()}
		{#if credentials.length > 1}
			<button class="btn text" onclick={() => copy(credentials.map(message).join('\n\n'), 'Tutti i messaggi copiati')}>
				Copia tutti
			</button>
		{/if}
		<button class="btn filled" onclick={() => (credOpen = false)}>Fatto</button>
	{/snippet}
</Dialog>

<Dialog open={confirmDelete !== null} title="Eliminare l'account?" icon="person_remove">
	<p>
		{confirmDelete?.display_name} non potrà più entrare nel wiki. Le pagine che ha scritto restano.
	</p>
	{#snippet actions()}
		<button class="btn text" onclick={() => (confirmDelete = null)}>Annulla</button>
		<button class="btn filled danger" onclick={remove}>Elimina</button>
	{/snippet}
</Dialog>

<style>
	.narrow {
		max-width: 820px;
	}
	h1 {
		margin: 8px 0 24px;
	}
	.add {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 20px;
		background: var(--md-primary-container);
		color: var(--md-on-primary-container);
		border-radius: var(--md-shape-lg);
	}
	.add h2,
	.maint h2 {
		margin: 0;
	}
	.add p {
		margin: 0;
		color: inherit;
		opacity: 0.85;
	}
	.add textarea {
		background: var(--md-surface-container-lowest);
		border-color: transparent;
		resize: vertical;
	}
	.accent {
		color: var(--md-primary);
	}
	.list-head {
		margin: 32px 0 8px;
	}
	.list-head h2 {
		margin: 0;
	}
	.filter {
		height: 40px;
		padding: 0 16px;
		border: 1px solid var(--md-outline-variant);
		border-radius: var(--md-shape-full);
		background: transparent;
		font: inherit;
		color: inherit;
	}
	.users {
		border-radius: var(--md-shape-lg);
		background: var(--md-surface-container-low);
	}
	.users li + li {
		border-top: 1px solid var(--md-outline-variant);
	}
	.users .list-item {
		overflow: visible;
		min-height: 72px;
	}
	.avatar {
		width: 40px;
		height: 40px;
		flex-shrink: 0;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: var(--md-secondary-container);
		color: var(--md-on-secondary-container);
		font-weight: 600;
		font-size: 14px;
	}
	.avatar.admin {
		background: var(--md-tertiary-container);
		color: var(--md-on-tertiary-container);
	}
	.headline .badge {
		margin-left: 6px;
		vertical-align: 1px;
	}
	.badge.you {
		background: var(--md-secondary-container);
		color: var(--md-on-secondary-container);
	}
	.menu-wrap {
		position: relative;
	}
	.menu-scrim {
		position: fixed;
		inset: 0;
		z-index: 9;
		border: none;
		background: transparent;
	}
	.menu {
		position: absolute;
		right: 0;
		top: 44px;
		z-index: 10;
		min-width: 240px;
		padding: 8px 0;
		border-radius: var(--md-shape-sm);
		background: var(--md-surface-container);
		box-shadow: var(--md-elev-2);
	}
	.menu .list-item {
		min-height: 48px;
		font-size: 14px;
	}
	.menu .danger,
	.menu .danger .icon {
		color: var(--md-error);
	}
	.maint {
		margin-top: 40px;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 12px;
		padding: 20px;
	}
	.maint p {
		margin: 0;
	}
	.creds {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 16px;
		max-height: 50dvh;
		overflow-y: auto;
	}
	.cred {
		display: flex;
		align-items: flex-end;
		gap: 12px;
		padding: 12px 12px 12px 16px;
		border-radius: var(--md-shape-md);
		background: var(--md-surface-container-lowest);
	}
	.cred pre {
		flex: 1;
		margin: 0;
		font-family: var(--font);
		font-size: 14px;
		white-space: pre-wrap;
		color: var(--md-on-surface);
	}
	@media (max-width: 600px) {
		.cred {
			flex-direction: column;
			align-items: stretch;
		}
	}
</style>
