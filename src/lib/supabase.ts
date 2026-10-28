import { createClient } from '@supabase/supabase-js';

// Public values: the publishable (anon) key only allows what the RLS policies allow,
// i.e. nothing at all until a member has logged in.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

export const configured = Boolean(SUPABASE_URL && SUPABASE_KEY);

export const supabase = createClient(SUPABASE_URL || 'http://localhost', SUPABASE_KEY || 'missing', {
	auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

export class ApiError extends Error {
	status: number;
	data: Record<string, unknown>;
	constructor(status: number, data: Record<string, unknown>) {
		super(typeof data.error === 'string' ? data.error : `Errore ${status}`);
		this.status = status;
		this.data = data;
	}
}

/** Call one of our edge functions with the current member's token. */
export async function callFunction<T = Record<string, unknown>>(name: 'wiki' | 'admin', body: Record<string, unknown>): Promise<T> {
	const { data: session } = await supabase.auth.getSession();
	const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			apikey: SUPABASE_KEY,
			Authorization: `Bearer ${session.session?.access_token ?? ''}`
		},
		body: JSON.stringify(body)
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new ApiError(res.status, data);
	return data as T;
}
