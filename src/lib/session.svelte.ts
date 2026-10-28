import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { usernameToEmail } from '../../supabase/functions/_shared/wiki-core';

export interface Profile {
	id: string;
	username: string;
	display_name: string;
	role: 'admin' | 'user';
}

class Session {
	user = $state<User | null>(null);
	profile = $state<Profile | null>(null);
	ready = $state(false);

	get isAdmin() {
		return this.profile?.role === 'admin';
	}

	get name() {
		return this.profile?.display_name || this.profile?.username || '';
	}

	async init() {
		const { data } = await supabase.auth.getSession();
		await this.#setUser(data.session?.user ?? null);
		this.ready = true;
		supabase.auth.onAuthStateChange((event, s) => {
			if (event === 'SIGNED_OUT') this.#setUser(null);
			else if (event === 'SIGNED_IN' && s?.user.id !== this.user?.id) this.#setUser(s?.user ?? null);
		});
	}

	async #setUser(user: User | null) {
		this.user = user;
		if (!user) {
			this.profile = null;
			return;
		}
		const { data } = await supabase.from('profiles').select('id, username, display_name, role').eq('id', user.id).maybeSingle();
		this.profile = data;
	}

	async login(username: string, password: string) {
		const { data, error } = await supabase.auth.signInWithPassword({
			email: usernameToEmail(username),
			password: password.trim()
		});
		if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Nome utente o password errati' : error.message);
		await this.#setUser(data.user);
	}

	async logout() {
		await supabase.auth.signOut();
		this.user = null;
		this.profile = null;
	}
}

export const session = new Session();
