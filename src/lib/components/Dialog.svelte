<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		open = $bindable(false),
		title,
		icon,
		children,
		actions,
		wide = false
	}: {
		open: boolean;
		title: string;
		icon?: string;
		children: Snippet;
		actions?: Snippet;
		wide?: boolean;
	} = $props();

	let dialog: HTMLDialogElement;

	$effect(() => {
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	});
</script>

<dialog
	bind:this={dialog}
	class:wide
	onclose={() => (open = false)}
	onclick={(e) => {
		if (e.target === dialog) open = false;
	}}
>
	{#if open}
		<div class="inner">
			{#if icon}<span class="icon hero">{icon}</span>{/if}
			<h2 class="headline-s" class:center={!!icon}>{title}</h2>
			<div class="content">{@render children()}</div>
			{#if actions}
				<div class="actions">{@render actions()}</div>
			{/if}
		</div>
	{/if}
</dialog>

<style>
	dialog {
		width: min(560px, calc(100vw - 32px));
		max-height: calc(100dvh - 48px);
		padding: 0;
		border: none;
		border-radius: var(--md-shape-xl);
		background: var(--md-surface-container-high);
		color: var(--md-on-surface);
		box-shadow: var(--md-elev-3);
	}
	dialog.wide {
		width: min(720px, calc(100vw - 32px));
	}
	dialog[open] {
		animation: in 300ms var(--md-ease-emphasized);
	}
	dialog::backdrop {
		background: var(--md-scrim);
	}
	.inner {
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.hero {
		align-self: center;
		color: var(--md-secondary);
	}
	h2 {
		margin: 0;
	}
	.center {
		text-align: center;
	}
	.content {
		color: var(--md-on-surface-variant);
		font-size: 14px;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: 8px;
		padding-top: 8px;
	}
	@keyframes in {
		from {
			opacity: 0;
			transform: scale(0.95) translateY(8px);
		}
	}
</style>
