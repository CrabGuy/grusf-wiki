// Edge function `wiki`: every write to a page goes through here so that the page file,
// its attic revision, the DokuWiki changelog and the search index stay in sync.
//
// POST { action: 'save', id, content, summary?, minor?, baseRev? }
//   - empty content deletes the page (like DokuWiki)
//   - baseRev is the revision the editor was opened on; a mismatch returns 409

import { handler, json } from '../_shared/http.ts';
import { ConflictError, savePage } from '../_shared/wiki-core.ts';

Deno.serve(
	handler(async (body, caller, sb) => {
		if (body.action !== 'save') return json({ error: 'Azione sconosciuta' }, 400);
		if (typeof body.id !== 'string' || typeof body.content !== 'string') {
			return json({ error: 'Parametri mancanti' }, 400);
		}
		try {
			const result = await savePage(sb, {
				id: body.id,
				content: body.content,
				summary: typeof body.summary === 'string' ? body.summary.slice(0, 255) : '',
				minor: body.minor === true,
				baseRev: body.baseRev === undefined ? undefined : (body.baseRev as number | null),
				type: body.restore === true ? 'R' : undefined,
				user: caller.username
			});
			return json(result);
		} catch (e) {
			if (e instanceof ConflictError) return json({ error: e.message, currentRev: e.currentRev }, 409);
			throw e;
		}
	})
);
