<script lang="ts">
	import { session } from '#lib/session.svelte.ts';

	let username = $state('');
	let password = $state('');
	let error = $state('');
	let busy = $state(false);
	let show = $state(false);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		busy = true;
		try {
			await session.login(username, password);
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}
</script>

<main class="login">
	<form class="card elevated" onsubmit={submit}>
		<div class="logo" aria-hidden="true"><span class="icon filled">menu_book</span></div>
		<h1 class="headline-s">GRUSF Wiki</h1>
		<p class="body-m muted">Gruppo Universitari San Frediano</p>

		<div class="field" class:error={!!error}>
			<label for="username">Nome utente</label>
			<input
				id="username"
				bind:value={username}
				autocomplete="username"
				autocapitalize="none"
				spellcheck="false"
				placeholder="mario.rossi"
				required
			/>
		</div>
		<div class="field" class:error={!!error}>
			<label for="password">Password</label>
			<div class="pw">
				<input
					id="password"
					type={show ? 'text' : 'password'}
					bind:value={password}
					autocomplete="current-password"
					autocapitalize="none"
					spellcheck="false"
					required
				/>
				<button
					type="button"
					class="icon-btn"
					aria-label={show ? 'Nascondi password' : 'Mostra password'}
					onclick={() => (show = !show)}
				>
					<span class="icon">{show ? 'visibility_off' : 'visibility'}</span>
				</button>
			</div>
			{#if error}<span class="supporting" role="alert">{error}</span>{/if}
		</div>

		<button class="btn filled" type="submit" disabled={busy}>
			{busy ? 'Accesso…' : 'Entra'}
		</button>
		<p class="body-s muted hint">Non hai un account? Chiedi a un amministratore del wiki.</p>
	</form>
</main>

<style>
	.login {
		min-height: 100dvh;
		display: grid;
		place-items: center;
		padding: 16px;
		background:
			radial-gradient(circle at 15% 20%, var(--md-tertiary-container) 0, transparent 40%),
			radial-gradient(circle at 85% 80%, var(--md-primary-container) 0, transparent 45%),
			var(--md-surface);
	}
	form {
		width: min(400px, 100%);
		padding: 32px 24px 24px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		border-radius: var(--md-shape-xl);
	}
	.logo {
		align-self: center;
		width: 64px;
		height: 64px;
		display: grid;
		place-items: center;
		border-radius: var(--md-shape-lg);
		background: var(--md-primary);
		color: var(--md-on-primary);
	}
	.logo .icon {
		font-size: 36px;
	}
	h1,
	p {
		margin: 0;
		text-align: center;
	}
	h1 {
		margin-bottom: -12px;
	}
	.pw {
		position: relative;
	}
	.pw input {
		padding-right: 52px;
	}
	.pw .icon-btn {
		position: absolute;
		right: 6px;
		top: 50%;
		transform: translateY(-50%);
	}
	.btn {
		height: 48px;
		margin-top: 8px;
	}
	.hint {
		margin-top: 4px;
	}
</style>
