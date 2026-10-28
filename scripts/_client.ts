// Shared setup for the maintenance scripts (run with Node >= 22, no build step needed).
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

export function adminClient() {
	const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
	const key = process.env.SUPABASE_SECRET_KEY;
	if (!url || !key) {
		console.error(
			'Mancano SUPABASE_URL (o VITE_SUPABASE_URL) e SUPABASE_SECRET_KEY nel file .env.\n' +
				'Trovi la secret key in Supabase > Project Settings > API Keys.'
		);
		process.exit(1);
	}
	return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function siteUrl() {
	return process.env.SITE_URL || '(indirizzo del wiki)';
}
