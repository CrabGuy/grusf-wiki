<script lang="ts">
	import { toast } from '#lib/toast.svelte.ts';
</script>

{#if toast.current}
	{#key toast.current.id}
		<div class="snackbar" class:error={toast.current.error} role="status" aria-live="polite">
			<span class="msg">{toast.current.message}</span>
			{#if toast.current.action}
				<button
					class="btn text action"
					onclick={() => {
						toast.current?.action?.run();
						toast.dismiss();
					}}>{toast.current.action.label}</button
				>
			{/if}
			<button class="icon-btn close" aria-label="Chiudi" onclick={() => toast.dismiss()}>
				<span class="icon">close</span>
			</button>
		</div>
	{/key}
{/if}

<style>
	.snackbar {
		position: fixed;
		left: 50%;
		bottom: 24px;
		transform: translateX(-50%);
		z-index: 100;
		display: flex;
		align-items: center;
		gap: 4px;
		min-height: 48px;
		max-width: min(560px, calc(100vw - 32px));
		padding: 4px 4px 4px 16px;
		border-radius: var(--md-shape-xs);
		background: var(--md-inverse-surface);
		color: var(--md-inverse-on-surface);
		box-shadow: var(--md-elev-3);
		font-size: 14px;
		animation: in 250ms var(--md-ease-emphasized);
	}
	.snackbar.error {
		background: var(--md-error-container);
		color: var(--md-on-error-container);
	}
	.msg {
		flex: 1;
		padding: 10px 0;
	}
	.action {
		color: var(--md-primary-container);
	}
	.error .action {
		color: var(--md-error);
	}
	.close {
		color: inherit;
	}
	@keyframes in {
		from {
			opacity: 0;
			transform: translate(-50%, 16px);
		}
	}
</style>
