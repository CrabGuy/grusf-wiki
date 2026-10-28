// Edge function `admin`: user management (admins only) and index rebuild.
//
// POST { action: 'list' }
// POST { action: 'create', names: string[] }            -> generated credentials
// POST { action: 'reset_password', id }                  -> new generated password
// POST { action: 'set_role', id, role: 'admin' | 'user' }
// POST { action: 'delete', id }
// POST { action: 'reindex' }                             -> rebuild index from storage

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { handler, json } from '../_shared/http.ts';
import { cleanUsername, generatePassword, reindex, usernameToEmail } from '../_shared/wiki-core.ts';

Deno.serve(
	handler(async (body, caller, sb) => {
		if (caller.role !== 'admin') return json({ error: 'Solo gli amministratori possono farlo' }, 403);

		switch (body.action) {
			case 'list':
				return json({ users: await listUsers(sb) });

			case 'create': {
				const names = Array.isArray(body.names) ? (body.names as unknown[]).map(String) : [];
				const created = [];
				const errors = [];
				for (const raw of names.map((n) => n.trim()).filter(Boolean)) {
					try {
						created.push(await createUser(sb, raw));
					} catch (e) {
						errors.push({ name: raw, error: e instanceof Error ? e.message : String(e) });
					}
				}
				return json({ created, errors });
			}

			case 'reset_password': {
				const password = generatePassword();
				const { error } = await sb.auth.admin.updateUserById(String(body.id), { password });
				if (error) return json({ error: error.message }, 400);
				const { data } = await sb.from('profiles').select('username, display_name').eq('id', body.id).single();
				return json({ ...data, password });
			}

			case 'set_role': {
				const role = body.role === 'admin' ? 'admin' : 'user';
				if (role === 'user' && (await isLastAdmin(sb, String(body.id)))) {
					return json({ error: 'Deve restare almeno un amministratore' }, 400);
				}
				const { error } = await sb.from('profiles').update({ role }).eq('id', body.id);
				if (error) return json({ error: error.message }, 400);
				return json({ ok: true });
			}

			case 'delete': {
				if (body.id === caller.id) return json({ error: 'Non puoi eliminare il tuo account' }, 400);
				if (await isLastAdmin(sb, String(body.id))) {
					return json({ error: 'Deve restare almeno un amministratore' }, 400);
				}
				const { error } = await sb.auth.admin.deleteUser(String(body.id));
				if (error) return json({ error: error.message }, 400);
				return json({ ok: true });
			}

			case 'reindex':
				return json(await reindex(sb));

			default:
				return json({ error: 'Azione sconosciuta' }, 400);
		}
	})
);

async function listUsers(sb: SupabaseClient) {
	const { data: profiles } = await sb.from('profiles').select('*').order('display_name');
	const { data } = await sb.auth.admin.listUsers({ perPage: 1000 });
	const lastSignIn = new Map(data?.users.map((u) => [u.id, u.last_sign_in_at]) ?? []);
	return (profiles ?? []).map((p) => ({ ...p, last_sign_in_at: lastSignIn.get(p.id) ?? null }));
}

/** "Mario Rossi" -> username `mario.rossi`, display name "Mario Rossi". Adds a number if taken. */
async function createUser(sb: SupabaseClient, name: string) {
	const base = cleanUsername(name);
	if (base.length < 2) throw new Error('Nome troppo corto');
	const displayName = name.includes(' ')
		? name.replace(/\s+/g, ' ')
		: name.charAt(0).toUpperCase() + name.slice(1);

	let username = base.slice(0, 30);
	for (let n = 2; ; n++) {
		const { data } = await sb.from('profiles').select('id').eq('username', username).maybeSingle();
		if (!data) break;
		username = `${base.slice(0, 28)}${n}`;
	}

	const password = generatePassword();
	const { data, error } = await sb.auth.admin.createUser({
		email: usernameToEmail(username),
		password,
		email_confirm: true,
		user_metadata: { username, display_name: displayName }
	});
	if (error || !data.user) throw new Error(error?.message ?? 'Creazione fallita');

	const { error: profileError } = await sb
		.from('profiles')
		.insert({ id: data.user.id, username, display_name: displayName, role: 'user' });
	if (profileError) {
		await sb.auth.admin.deleteUser(data.user.id);
		throw new Error(profileError.message);
	}
	return { id: data.user.id, username, display_name: displayName, password };
}

async function isLastAdmin(sb: SupabaseClient, id: string) {
	const { data } = await sb.from('profiles').select('id').eq('role', 'admin');
	return (data ?? []).length === 1 && data![0].id === id;
}
