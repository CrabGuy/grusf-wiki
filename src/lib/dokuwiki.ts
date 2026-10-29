// DokuWiki markup -> HTML.
//
// Supports the syntax used by a stock DokuWiki install: headings, paragraphs, bold/italic/
// underline/monospace/del/sub/sup, links (internal, external, interwiki, section anchors),
// media, lists, tables (with colspan/rowspan/alignment), quotes, code/file blocks, preformatted
// text, footnotes, horizontal rules, forced line breaks, %%/nowiki escapes and the common
// <note>/<WRAP> plugins. Everything that is not markup is HTML-escaped, so the output is safe
// to inject with {@html}.

import { getNs, resolveId } from '../../supabase/functions/_shared/wiki-core';

export interface Heading {
	level: number;
	id: string;
	text: string;
}

export interface RenderOptions {
	/** Current page id, used to resolve relative links. */
	pageId: string;
	/** Href for an internal page id (+ optional section). */
	pageHref: (id: string, hash?: string) => string;
	/** Returns true if the page exists (links to missing pages are styled differently). */
	exists?: (id: string) => boolean;
}

export interface RenderResult {
	html: string;
	headings: Heading[];
}

interface Ctx extends RenderOptions {
	ns: string;
	headings: Heading[];
	usedIds: Set<string>;
	footnotes: string[];
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const INTERWIKI: Record<string, string> = {
	wp: 'https://en.wikipedia.org/wiki/',
	wpit: 'https://it.wikipedia.org/wiki/',
	doku: 'https://www.dokuwiki.org/',
	google: 'https://www.google.com/search?q='
};

export function render(text: string, opts: RenderOptions): RenderResult {
	const ctx: Ctx = { ...opts, ns: getNs(opts.pageId), headings: [], usedIds: new Set(), footnotes: [] };
	const clean = text.replace(/\r\n?/g, '\n').replace(/~~[A-Z_]+~~/g, '');
	let html = blocks(clean.split('\n'), ctx);
	if (ctx.footnotes.length) {
		html +=
			'<div class="footnotes">' +
			ctx.footnotes
				.map((f, i) => `<div class="fn"><sup><a href="#fnt__${i + 1}" id="fn__${i + 1}">${i + 1})</a></sup> ${f}</div>`)
				.join('') +
			'</div>';
	}
	return { html, headings: ctx.headings };
}

// ---------------------------------------------------------------------------
// Block level
// ---------------------------------------------------------------------------

const RE = {
	heading: /^[ \t]*(={2,6})(.+?)={2,6}[ \t]*$/,
	hr: /^[ \t]*-{4,}[ \t]*$/,
	list: /^( {2,}|\t+)([*-])\s?(.*)$/,
	pre: /^( {2,}|\t)(.*)$/,
	table: /^[ \t]*[\^|]/,
	quote: /^>+/,
	code: /^[ \t]*<(code|file|html|php)(\s[^>]*)?>(.*)$/i,
	box: /^[ \t]*<(note|wrap)(\s[^>]*)?>(.*)$/i
};

function blocks(lines: string[], ctx: Ctx): string {
	let out = '';
	let para: string[] = [];
	const flush = () => {
		if (para.length) out += `<p>${inline(para.join('\n'), ctx)}</p>`;
		para = [];
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		let m: RegExpMatchArray | null;

		if (!line.trim()) {
			flush();
			continue;
		}

		// A link split over two lines (`[[url` / `|label]]`): like DokuWiki, finish the link
		// before looking at the next line as a table row or list item.
		if (para.length && openLinks(para.join('\n')) > 0) {
			para.push(line.trim());
			continue;
		}

		if ((m = line.match(RE.code))) {
			flush();
			const tag = m[1].toLowerCase();
			const close = new RegExp(`</${tag}>`, 'i');
			const args = (m[2] ?? '').trim().split(/\s+/).filter(Boolean);
			const body: string[] = [];
			let first = m[3];
			while (true) {
				const end = first.search(close);
				if (end !== -1) {
					body.push(first.slice(0, end));
					break;
				}
				body.push(first);
				if (++i >= lines.length) break;
				first = lines[i];
			}
			if (body.length && !body[0].trim()) body.shift();
			if (body.length && !body[body.length - 1].trim()) body.pop();
			const lang = args[0] && args[0] !== '-' ? args[0] : '';
			const file = tag === 'file' && args[1] ? `<div class="filename">${esc(args[1])}</div>` : '';
			out += `<div class="codeblock">${file}<pre${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${esc(body.join('\n'))}</code></pre></div>`;
			continue;
		}

		if ((m = line.match(RE.box))) {
			flush();
			const tag = m[1].toLowerCase();
			const close = new RegExp(`</${tag}>`, 'i');
			const kind = (m[2] ?? '').trim().toLowerCase().split(/\s+/)[0] || (tag === 'note' ? 'info' : '');
			const body: string[] = [];
			let first = m[3];
			while (true) {
				const end = first.search(close);
				if (end !== -1) {
					body.push(first.slice(0, end));
					break;
				}
				body.push(first);
				if (++i >= lines.length) break;
				first = lines[i];
			}
			const cls = tag === 'note' ? `note note-${esc(kind.replace(/[^a-z]/g, ''))}` : 'wrap';
			out += `<div class="${cls}">${blocks(body, ctx)}</div>`;
			continue;
		}

		if ((m = line.match(RE.heading))) {
			flush();
			const level = Math.max(1, 7 - m[1].length);
			const textRaw = m[2].trim();
			const id = uniqueId(sectionId(textRaw), ctx);
			ctx.headings.push({ level, id, text: textRaw });
			out += `<h${level} id="${id}">${esc(textRaw)}</h${level}>`;
			continue;
		}

		if (RE.hr.test(line)) {
			flush();
			out += '<hr>';
			continue;
		}

		if (RE.list.test(line)) {
			flush();
			const items: { depth: number; type: 'ul' | 'ol'; text: string }[] = [];
			while (i < lines.length && (m = lines[i].match(RE.list))) {
				const indent = m[1].replace(/\t/g, '  ').length;
				items.push({ depth: Math.floor(indent / 2), type: m[2] === '*' ? 'ul' : 'ol', text: m[3] });
				i++;
			}
			i--;
			out += list(items, ctx);
			continue;
		}

		if (RE.table.test(line)) {
			flush();
			const rows: string[] = [];
			while (i < lines.length && RE.table.test(lines[i])) rows.push(lines[i++].trim());
			i--;
			out += table(rows, ctx);
			continue;
		}

		if (RE.quote.test(line)) {
			flush();
			const q: { depth: number; text: string }[] = [];
			while (i < lines.length && (m = lines[i].match(/^(>+)\s?(.*)$/))) {
				q.push({ depth: m[1].length, text: m[2] });
				i++;
			}
			i--;
			out += quote(q, ctx);
			continue;
		}

		if (RE.pre.test(line) && !para.length) {
			const pre: string[] = [];
			while (i < lines.length && (m = lines[i].match(RE.pre)) && !RE.list.test(lines[i])) {
				pre.push(lines[i].replace(/^( {2}|\t)/, ''));
				i++;
			}
			i--;
			out += `<pre class="pre">${esc(pre.join('\n'))}</pre>`;
			continue;
		}

		para.push(line.trim());
	}
	flush();
	return out;
}

function list(items: { depth: number; type: 'ul' | 'ol'; text: string }[], ctx: Ctx): string {
	let html = '';
	const stack: { depth: number; type: string }[] = [];
	const top = () => stack[stack.length - 1];
	for (const item of items) {
		if (!stack.length || item.depth > top().depth) {
			html += `<${item.type}>`;
			stack.push(item);
		} else {
			while (stack.length > 1 && top().depth > item.depth) html += `</li></${stack.pop()!.type}>`;
			if (top().type !== item.type) {
				html += `</li></${stack.pop()!.type}><${item.type}>`;
				stack.push(item);
			} else {
				html += '</li>';
			}
		}
		let text = item.text;
		let check = '';
		const cm = text.match(/^\[( |x|X)\]\s*/);
		if (cm) {
			check = `<span class="task${cm[1] === ' ' ? '' : ' done'}" aria-hidden="true"></span>`;
			text = text.slice(cm[0].length);
		}
		html += `<li${check ? ' class="tasklist"' : ''}>${check}${inline(text, ctx)}`;
	}
	while (stack.length) html += `</li></${stack.pop()!.type}>`;
	return html;
}

function quote(lines: { depth: number; text: string }[], ctx: Ctx): string {
	let html = '';
	let depth = 0;
	for (const l of lines) {
		while (depth < l.depth) (html += '<blockquote>'), depth++;
		while (depth > l.depth) (html += '</blockquote>'), depth--;
		html += `<p>${inline(l.text, ctx)}</p>`;
	}
	while (depth-- > 0) html += '</blockquote>';
	return html;
}

interface Cell {
	tag: 'th' | 'td';
	raw: string;
	colspan: number;
	rowspan: number;
	col: number;
	hidden: boolean;
}

function splitRow(line: string): { tag: 'th' | 'td'; raw: string }[] {
	const cells: { tag: 'th' | 'td'; raw: string }[] = [];
	let tag: 'th' | 'td' = line[0] === '^' ? 'th' : 'td';
	let buf = '';
	const pairs: [string, string][] = [
		['[[', ']]'],
		['{{', '}}'],
		['%%', '%%'],
		['<nowiki>', '</nowiki>'],
		["''", "''"]
	];
	for (let i = 1; i < line.length; i++) {
		const pair = pairs.find(([open]) => line.startsWith(open, i));
		if (pair) {
			const end = line.indexOf(pair[1], i + pair[0].length);
			if (end !== -1) {
				buf += line.slice(i, end + pair[1].length);
				i = end + pair[1].length - 1;
				continue;
			}
		}
		const c = line[i];
		if (c === '^' || c === '|') {
			cells.push({ tag, raw: buf });
			tag = c === '^' ? 'th' : 'td';
			buf = '';
		} else buf += c;
	}
	if (buf.trim()) cells.push({ tag, raw: buf });
	return cells;
}

function table(lines: string[], ctx: Ctx): string {
	const grid: Cell[][] = [];
	for (const line of lines) {
		const row: Cell[] = [];
		let col = 0;
		for (const c of splitRow(line)) {
			if (c.raw === '' && row.length) {
				row[row.length - 1].colspan++;
				col++;
				continue;
			}
			const cell: Cell = { ...c, colspan: 1, rowspan: 1, col, hidden: false };
			if (c.raw.trim() === ':::') {
				cell.hidden = true;
				for (let r = grid.length - 1; r >= 0; r--) {
					const above = grid[r].find((x) => x.col === col);
					if (above && !above.hidden) {
						above.rowspan++;
						break;
					}
				}
			}
			row.push(cell);
			col++;
		}
		grid.push(row);
	}
	let html = '<div class="table-wrap"><table>';
	for (const row of grid) {
		html += '<tr>';
		for (const c of row) {
			if (c.hidden) continue;
			const left = /^ {2,}/.test(c.raw);
			const right = / {2,}$/.test(c.raw);
			const align = left && right ? 'center' : left ? 'right' : '';
			const attrs =
				(c.colspan > 1 ? ` colspan="${c.colspan}"` : '') +
				(c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : '') +
				(align ? ` class="${align}"` : '');
			html += `<${c.tag}${attrs}>${inline(c.raw.trim(), ctx)}</${c.tag}>`;
		}
		html += '</tr>';
	}
	return html + '</table></div>';
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

const PAIRS: [string, string, string][] = [
	['**', '**', 'strong'],
	['//', '//', 'em'],
	['__', '__', 'u'],
	['<del>', '</del>', 'del'],
	['<sub>', '</sub>', 'sub'],
	['<sup>', '</sup>', 'sup']
];

const TYPO: [string, string][] = [
	['<->', '↔'],
	['->', '→'],
	['<-', '←'],
	['<=>', '⇔'],
	['=>', '⇒'],
	['<=', '⇐'],
	['...', '…'],
	['(c)', '©'],
	['(tm)', '™'],
	['(r)', '®']
];

const BARE_URL = /^(?:https?|ftp):\/\/[^\s<>"[\]|]*[^\s<>"[\]|.,;:!?)'"]/;

function inline(s: string, ctx: Ctx): string {
	let out = '';
	let i = 0;
	outer: while (i < s.length) {
		const c = s[i];

		if (s.startsWith('%%', i)) {
			const end = s.indexOf('%%', i + 2);
			if (end !== -1) {
				out += esc(s.slice(i + 2, end));
				i = end + 2;
				continue;
			}
		}
		if (s.startsWith('<nowiki>', i)) {
			const end = s.indexOf('</nowiki>', i + 8);
			if (end !== -1) {
				out += esc(s.slice(i + 8, end));
				i = end + 9;
				continue;
			}
		}
		if (s.startsWith("''", i)) {
			const end = findClose(s, i + 2, "''");
			if (end > i + 2) {
				out += `<code>${inline(s.slice(i + 2, end), ctx)}</code>`;
				i = end + 2;
				continue;
			}
		}
		if (s.startsWith('[[', i)) {
			const end = findClose(s, i + 2, ']]');
			if (end !== -1) {
				out += link(s.slice(i + 2, end), ctx);
				i = end + 2;
				continue;
			}
		}
		if (s.startsWith('{{', i)) {
			const end = s.indexOf('}}', i + 2);
			if (end !== -1) {
				out += media(s.slice(i + 2, end), ctx);
				i = end + 2;
				continue;
			}
		}
		if (s.startsWith('((', i)) {
			const end = findClose(s, i + 2, '))');
			if (end !== -1) {
				ctx.footnotes.push(inline(s.slice(i + 2, end), ctx));
				const n = ctx.footnotes.length;
				out += `<sup><a href="#fn__${n}" id="fnt__${n}" class="fn_top">${n})</a></sup>`;
				i = end + 2;
				continue;
			}
		}
		if (s.startsWith('\\\\', i) && (i + 2 >= s.length || /\s/.test(s[i + 2]))) {
			out += '<br>';
			i += 2;
			continue;
		}
		if ((c === 'h' || c === 'f') && (i === 0 || /[\s(]/.test(s[i - 1]))) {
			const m = s.slice(i).match(BARE_URL);
			if (m) {
				out += externalLink(m[0], esc(m[0]));
				i += m[0].length;
				continue;
			}
		}
		for (const [open, close, tag] of PAIRS) {
			if (s.startsWith(open, i)) {
				const end = findClose(s, i + open.length, close);
				if (end > i + open.length) {
					out += `<${tag}>${inline(s.slice(i + open.length, end), ctx)}</${tag}>`;
					i = end + close.length;
					continue outer;
				}
			}
		}
		for (const [from, to] of TYPO) {
			if (s.startsWith(from, i)) {
				out += to;
				i += from.length;
				continue outer;
			}
		}
		out += c === '\n' ? ' ' : esc(c);
		i++;
	}
	return out;
}

/** Number of `[[` without a matching `]]`. */
function openLinks(s: string): number {
	return (s.match(/\[\[/g)?.length ?? 0) - (s.match(/\]\]/g)?.length ?? 0);
}

/** Index of `close` after `from`, skipping over nested [[...]], {{...}} and %%...%%. */
function findClose(s: string, from: number, close: string): number {
	for (let i = from; i < s.length; i++) {
		if (s.startsWith(close, i)) return i;
		for (const [o, c] of [
			['[[', ']]'],
			['{{', '}}'],
			['%%', '%%'],
			['<nowiki>', '</nowiki>']
		]) {
			if (o !== close && s.startsWith(o, i)) {
				const end = s.indexOf(c, i + o.length);
				if (end !== -1) {
					i = end + c.length - 1;
					break;
				}
			}
		}
	}
	return -1;
}

function link(body: string, ctx: Ctx): string {
	const bar = body.indexOf('|');
	const target = (bar === -1 ? body : body.slice(0, bar)).trim();
	const label = bar === -1 ? '' : body.slice(bar + 1).trim();
	const labelHtml = label ? inline(label, ctx) : '';

	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) {
		return externalLink(target, labelHtml || esc(target));
	}
	if (/^mailto:/i.test(target) || /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(target)) {
		const addr = target.replace(/^mailto:/i, '');
		return `<a class="mail" href="mailto:${esc(addr)}">${labelHtml || esc(addr)}</a>`;
	}
	const iw = target.match(/^([a-z]+)>(.+)$/i);
	if (iw) {
		const base = INTERWIKI[iw[1].toLowerCase()];
		if (base) return externalLink(base + encodeURIComponent(iw[2]), labelHtml || esc(iw[2]));
		return labelHtml || esc(iw[2]);
	}

	const [pagePart, hash] = target.split('#');
	const id = pagePart ? resolveId(pagePart, ctx.ns) : ctx.pageId;
	const anchor = hash ? sectionId(hash) : undefined;
	const exists = ctx.exists ? ctx.exists(id) : true;
	const text = labelHtml || esc(pagePart ? (hash ? `${pagePart}#${hash}` : pagePart) : `#${hash}`);
	return `<a class="${exists ? 'wikilink1' : 'wikilink2'}" href="${esc(ctx.pageHref(id, anchor))}" title="${esc(id)}">${text}</a>`;
}

function externalLink(url: string, labelHtml: string): string {
	if (!/^(https?|ftp|mailto):/i.test(url)) return labelHtml;
	return `<a class="urlextern" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${labelHtml}</a>`;
}

function media(body: string, ctx: Ctx): string {
	if (/^[a-z]+>/i.test(body.trim())) {
		// Plugin syntax like {{indexmenu>...}} - not supported, show it muted.
		return `<span class="unsupported">${esc(`{{${body}}}`)}</span>`;
	}
	const bar = body.indexOf('|');
	const src = bar === -1 ? body : body.slice(0, bar);
	const caption = bar === -1 ? '' : body.slice(bar + 1).trim();
	const leftPad = /^\s/.test(src);
	const rightPad = /\s$/.test(src);
	const align = leftPad && rightPad ? 'mediacenter' : leftPad ? 'mediaright' : rightPad ? 'medialeft' : '';

	const [pathRaw, query = ''] = src.trim().split('?');
	const params = query.split('&');
	let width = '';
	let height = '';
	for (const p of params) {
		const m = p.match(/^(\d+)(?:x(\d+))?$/);
		if (m) {
			width = m[1];
			height = m[2] ?? '';
		}
	}
	const external = /^https?:\/\//i.test(pathRaw);
	const id = external ? pathRaw : resolveId(pathRaw, ctx.ns).replace(/:start$/, '');
	const name = pathRaw.split(/[:/]/).pop() ?? pathRaw;
	const sizeAttrs = (width ? ` width="${width}"` : '') + (height ? ` height="${height}"` : '');

	if (!IMAGE_EXT.test(pathRaw)) {
		const attr = external ? `href="${esc(pathRaw)}" target="_blank" rel="noopener noreferrer"` : `data-media-link="${esc(id)}" href="#"`;
		return `<a class="mediafile" ${attr}>${esc(caption || name)}</a>`;
	}

	const alt = esc(caption || name);
	const img = external
		? `<img src="${esc(pathRaw)}" alt="${alt}" class="media ${align}"${sizeAttrs} loading="lazy">`
		: `<img data-media="${esc(id)}" alt="${alt}" class="media ${align}"${sizeAttrs} loading="lazy">`;
	if (params.includes('nolink') || external) return img;
	return `<a class="medialink" data-media-link="${esc(id)}" href="#">${img}</a>`;
}

// ---------------------------------------------------------------------------

export function esc(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** DokuWiki-style section anchor: lowercase, accents stripped, non-alphanumerics as `_`. */
export function sectionId(text: string): string {
	return (
		text
			.toLowerCase()
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, '') || 'section'
	);
}

function uniqueId(id: string, ctx: Ctx): string {
	let out = id;
	for (let n = 1; ctx.usedIds.has(out); n++) out = `${id}${n}`;
	ctx.usedIds.add(out);
	return out;
}
