import { diffLines } from './diff';

interface Hunk {
	/** Replaced range of base lines, [start, end). Empty for pure insertions. */
	start: number;
	end: number;
	lines: string[];
	side: 0 | 1;
}

function hunks(base: string, other: string, side: 0 | 1): Hunk[] {
	const out: Hunk[] = [];
	let i = 0;
	let cur: Hunk | null = null;
	for (const d of diffLines(base, other)) {
		if (d.type === 'same') {
			cur = null;
			i++;
			continue;
		}
		if (!cur) {
			cur = { start: i, end: i, lines: [], side };
			out.push(cur);
		}
		if (d.type === 'del') cur.end = ++i;
		else cur.lines.push(d.text);
	}
	return out;
}

export const CONFLICT_START = '<<<<<<< ';
export const hasConflictMarkers = (text: string) => /^<<<<<<< .*\n[\s\S]*?^=======$[\s\S]*?^>>>>>>> /m.test(text);

/**
 * Line based three-way merge. Edits to different parts of the page combine;
 * when both sides add lines at the same spot both additions are kept (theirs
 * first, since it was saved first). Overlapping edits become conflicts,
 * written with git-style markers so they can be fixed by hand in the editor.
 */
export function merge3(
	base: string,
	mine: string,
	theirs: string,
	labels = { mine: 'la tua versione', theirs: 'versione online' }
): { text: string; conflicts: number } {
	if (mine === theirs || base === theirs) return { text: mine, conflicts: 0 };
	if (base === mine) return { text: theirs, conflicts: 0 };

	const b = base.split('\n');
	const all = [...hunks(base, mine, 0), ...hunks(base, theirs, 1)].sort((x, y) => x.start - y.start || x.end - y.end);
	const out: string[] = [];
	let pos = 0;
	let conflicts = 0;

	for (let k = 0; k < all.length; ) {
		// Group hunks that overlap or touch; each group is merged as a unit.
		const group = [all[k]];
		const start = all[k].start;
		let end = all[k].end;
		for (k++; k < all.length && all[k].start <= end; k++) {
			group.push(all[k]);
			end = Math.max(end, all[k].end);
		}
		out.push(...b.slice(pos, start));

		const version = (side: 0 | 1) => {
			const hs = group.filter((h) => h.side === side);
			if (!hs.length) return null;
			const lines: string[] = [];
			let p = start;
			for (const h of hs) {
				lines.push(...b.slice(p, h.start), ...h.lines);
				p = h.end;
			}
			lines.push(...b.slice(p, end));
			return lines;
		};
		const m = version(0);
		const t = version(1);
		if (!m || !t) out.push(...(m ?? t)!);
		else if (m.join('\n') === t.join('\n')) out.push(...m);
		else if (start === end) out.push(...t, ...m);
		else {
			conflicts++;
			out.push(`${CONFLICT_START}${labels.mine}`, ...m, '=======', ...t, `>>>>>>> ${labels.theirs}`);
		}
		pos = end;
	}
	out.push(...b.slice(pos));
	return { text: out.join('\n'), conflicts };
}
