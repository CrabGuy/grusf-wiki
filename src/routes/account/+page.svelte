<script lang="ts">
	import { goto } from '$app/navigation';
	import { supabase } from '#lib/supabase.ts';
	import { session } from '#lib/session.svelte.ts';
	import { toast } from '#lib/toast.svelte.ts';
	import { generatePassword, href } from '#lib/wiki.svelte.ts';

	let password = $state('');
	let confirm = $state('');
	let show = $state(false);
	let busy = $state(false);

	const error = $derived(
		password && password.length < 8
			? 'Almeno 8 caratteri'
			: confirm && confirm !== password
				? 'Le due password non coincidono'
				: ''
	);

	function suggest() {
		password = confirm = generatePassword();
		show = true;
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (error || !password) return;
		busy = true;
		const { error: err } = await supabase.auth.updateUser({ password });
		busy = false;
		if (err) return toast.error(err.message);
		toast.show('Password cambiata');
		goto(href('/'));
	}
</script>

<svelte:head><title>Il mio account · GRUSF Wiki</title></svelte:head>

<div class="page narrow">
	<h1 class="headline-m">Il mio account</h1>
	<div class="card who">
		<span class="title-m">{session.name}</span>
		<span class="body-m muted">Nome utente: <strong>{session.profile?.username}</strong></span>
	</div>

	<form class="card outlined stack" onsubmit={submit}>
		<h2 class="title-m">Cambia password</h2>
		<div class="field">
			<label for="pw1">Nuova password</label>
			<input id="pw1" type={show ? 'text' : 'password'} bind:value={password} autocomplete="new-password" />
		</div>
		<div class="field" class:error={!!error}>
			<label for="pw2">Ripeti la password</label>
			<input id="pw2" type={show ? 'text' : 'password'} bind:value={confirm} autocomplete="new-password" />
			{#if error}<span class="supporting">{error}</span>{/if}
		</div>
		<div class="row wrap">
			<button type="button" class="btn text" onclick={suggest}><span class="icon">casino</span> Suggeriscine una</button>
			<label class="row body-m show"><input type="checkbox" bind:checked={show} /> Mostra</label>
			<span class="spacer"></span>
			<button class="btn filled" type="submit" disabled={busy || !!error || !password || password !== confirm}>Salva</button>
		</div>
	</form>
</div>

<style>
	.narrow {
		max-width: 560px;
	}
	h1 {
		margin: 8px 0 24px;
	}
	h2 {
		margin: 0;
	}
	.who {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 16px;
	}
	form {
		padding: 20px;
	}
	.show {
		gap: 6px;
		color: var(--md-on-surface-variant);
	}
	.show input {
		accent-color: var(--md-primary);
	}
</style>
