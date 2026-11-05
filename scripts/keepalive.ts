// Create (or update) the daily cron-job.org job that keeps the free Supabase project awake.
//
//   npm run keepalive            needs CRONJOB_API_KEY, VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env
//
// The job calls the `ping()` database function through the REST API with the public key
// (see supabase/migrations/20261105000000_keepalive_usage.sql).

import 'dotenv/config';

const TITLE = 'GRUSF wiki keep-alive';
const apiKey = process.env.CRONJOB_API_KEY;
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!apiKey || !url || !publicKey) {
	console.error('Servono CRONJOB_API_KEY, VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY nel file .env.');
	process.exit(1);
}

async function api(method: string, path: string, body?: unknown) {
	const res = await fetch('https://api.cron-job.org' + path, {
		method,
		headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	if (!res.ok) throw new Error(`cron-job.org ${method} ${path}: HTTP ${res.status} ${await res.text()}`);
	const text = await res.text();
	return text ? JSON.parse(text) : {};
}

// Check the endpoint first, so a typo doesn't become a job that fails every day.
const pingUrl = `${url.replace(/\/$/, '')}/rest/v1/rpc/ping`;
const headers = { apikey: publicKey, 'Content-Type': 'application/json' };
const test = await fetch(pingUrl, { method: 'POST', headers, body: '{}' });
if (!test.ok) throw new Error(`Il ping non risponde: HTTP ${test.status} ${await test.text()}`);
console.log(`Ping ok: ${await test.text()}`);

const job = {
	url: pingUrl,
	title: TITLE,
	enabled: true,
	saveResponses: true,
	requestMethod: 1, // POST
	requestTimeout: 30,
	schedule: {
		timezone: 'Europe/Rome',
		expiresAt: 0,
		hours: [4],
		minutes: [17],
		mdays: [-1],
		months: [-1],
		wdays: [-1]
	},
	notification: { onFailure: true, onFailureCount: 2, onSuccess: true, onDisable: true },
	extendedData: { headers, body: '{}' }
};

const { jobs } = await api('GET', '/jobs');
const existing = (jobs as { jobId: number; title: string }[]).find((j) => j.title === TITLE);
if (existing) {
	await api('PATCH', `/jobs/${existing.jobId}`, { job });
	console.log(`Job aggiornato (id ${existing.jobId}).`);
} else {
	const { jobId } = await api('PUT', '/jobs', { job });
	console.log(`Job creato (id ${jobId}): ogni giorno alle 04:17, ora italiana.`);
}
