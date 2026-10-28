interface Toast {
	id: number;
	message: string;
	action?: { label: string; run: () => void };
	error?: boolean;
}

class Toaster {
	current = $state<Toast | null>(null);
	#timer: ReturnType<typeof setTimeout> | undefined;
	#n = 0;

	show(message: string, opts: { action?: Toast['action']; error?: boolean; duration?: number } = {}) {
		clearTimeout(this.#timer);
		this.current = { id: ++this.#n, message, ...opts };
		this.#timer = setTimeout(() => (this.current = null), opts.duration ?? (opts.action ? 8000 : 4000));
	}

	error(e: unknown) {
		this.show(e instanceof Error ? e.message : String(e), { error: true, duration: 6000 });
	}

	dismiss() {
		clearTimeout(this.#timer);
		this.current = null;
	}
}

export const toast = new Toaster();
