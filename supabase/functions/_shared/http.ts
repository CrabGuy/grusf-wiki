import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
	'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

export function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...corsHeaders, 'Content-Type': 'application/json' }
	});
}

export function serviceClient(): SupabaseClient {
	return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
		auth: { persistSession: false, autoRefreshToken: false }
	});
}

export interface Caller {
	id: string;
	username: string;
	role: 'admin' | 'user';
}

/** Resolve the logged in member from the request's bearer token. */
export async function getCaller(req: Request, sb: SupabaseClient): Promise<Caller | null> {
	const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
	if (!token) return null;
	const { data, error } = await sb.auth.getUser(token);
	if (error || !data.user) return null;
	const { data: profile } = await sb
		.from('profiles')
		.select('username, role')
		.eq('id', data.user.id)
		.maybeSingle();
	if (!profile) return null;
	return { id: data.user.id, username: profile.username, role: profile.role };
}

/** Boilerplate shared by every function: CORS preflight, auth, JSON body, error handling. */
export function handler(fn: (body: Record<string, unknown>, caller: Caller, sb: SupabaseClient) => Promise<Response>) {
	return async (req: Request) => {
		if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
		if (req.method !== 'POST') return json({ error: 'Metodo non consentito' }, 405);
		try {
			const sb = serviceClient();
			const caller = await getCaller(req, sb);
			if (!caller) return json({ error: 'Accesso richiesto' }, 401);
			const body = await req.json().catch(() => ({}));
			return await fn(body, caller, sb);
		} catch (e) {
			console.error(e);
			return json({ error: e instanceof Error ? e.message : String(e) }, 500);
		}
	};
}
