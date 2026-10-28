export type DiffLine = { type: 'same' | 'add' | 'del'; text: string };

/** Line based diff (LCS). Good enough for wiki pages of a few hundred lines. */
export function diffLines(a: string, b: string): DiffLine[] {
	const x = a.split('\n');
	const y = b.split('\n');
	const n = x.length;
	const m = y.length;
	const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
		}
	}
	const out: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (x[i] === y[j]) {
			out.push({ type: 'same', text: x[i] });
			i++;
			j++;
		} else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
			out.push({ type: 'del', text: x[i++] });
		} else {
			out.push({ type: 'add', text: y[j++] });
		}
	}
	while (i < n) out.push({ type: 'del', text: x[i++] });
	while (j < m) out.push({ type: 'add', text: y[j++] });
	return out;
}
