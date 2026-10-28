// Create the first administrator (afterwards admins create users from the web page).
//
//   npm run create-admin -- <username> ["Nome Cognome"]

import { adminClient, siteUrl } from './_client.ts';
import { cleanUsername, generatePassword, usernameToEmail } from '../supabase/functions/_shared/wiki-core.ts';

const [rawUser, displayName] = process.argv.slice(2);
if (!rawUser) {
	console.error('Uso: npm run create-admin -- <nome.utente> ["Nome Cognome"]');
	process.exit(1);
}

const username = cleanUsername(rawUser);
const sb = adminClient();
const password = generatePassword();

const { data: existing } = await sb.from('profiles').select('id').eq('username', username).maybeSingle();
if (existing) {
	// Already there: promote to admin and reset the password.
	await sb.from('profiles').update({ role: 'admin' }).eq('id', existing.id);
	const { error } = await sb.auth.admin.updateUserById(existing.id, { password });
	if (error) throw error;
} else {
	const { data, error } = await sb.auth.admin.createUser({
		email: usernameToEmail(username),
		password,
		email_confirm: true,
		user_metadata: { username, display_name: displayName ?? username }
	});
	if (error || !data.user) throw error ?? new Error('Creazione fallita');
	const { error: pErr } = await sb
		.from('profiles')
		.insert({ id: data.user.id, username, display_name: displayName ?? username, role: 'admin' });
	if (pErr) throw pErr;
}

console.log(`Amministratore pronto:\n  sito:     ${siteUrl()}\n  utente:   ${username}\n  password: ${password}`);
