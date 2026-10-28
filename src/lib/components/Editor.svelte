<script lang="ts">
	import { onMount } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { toast } from '#lib/toast.svelte.ts';
	import { sync, type SaveBase } from '#lib/sync.svelte.ts';
	import { hasConflictMarkers } from '#lib/merge.ts';
	import { getNs, pageHref, pageIndex, uploadMedia, timeAgo } from '#lib/wiki.svelte.ts';
	import WikiContent from './WikiContent.svelte';
	import Dialog from './Dialog.svelte';

	let {
		id,
		initial,
		base,
		baseContent,
		isNew,
		useDraft = false
	}: { id: string; initial: string; base: SaveBase; baseContent: string; isNew: boolean; useDraft?: boolean } = $props();

	// svelte-ignore state_referenced_locally -- the editor is keyed by page id, initial is read once
	let text = $state(initial);
	let summary = $state('');
	let minor = $state(false);
	let uploading = $state(0);
	let preview = $state(true);
	let mobileTab = $state<'write' | 'preview'>('write');
	let previewText = $state('');
	let dragging = $state(false);
	let deleteOpen = $state(false);
	let linkOpen = $state(false);
	let linkQuery = $state('');
	let draft = $state<{ text: string; savedAt: number } | null>(null);
	let ta: HTMLTextAreaElement;
	let fileInput: HTMLInputElement;
	let saved = false;

	const ns = $derived(getNs(id));
	// svelte-ignore state_referenced_locally
	const dirty = $derived(text !== initial);
	const draftKey = $derived(`grusf-draft:${id}`);

	// --------------------------------------------------------------- preview
	$effect(() => {
		const t = text;
		const timer = setTimeout(() => (previewText = t), previewText ? 200 : 0);
		return () => clearTimeout(timer);
	});

	// ---------------------------------------------------------------- drafts
	onMount(() => {
		preview = window.innerWidth > 1100;
		try {
			const raw = localStorage.getItem(draftKey);
			if (raw) {
				const d = JSON.parse(raw);
				if (d.text && d.text !== initial) {
					// Coming from "merge by hand": open straight on the combined text.
					if (useDraft) text = d.text;
					else draft = d;
				} else localStorage.removeItem(draftKey);
			}
		} catch {
			/* storage unavailable */
		}
		if (!draft) {
			ta.focus();
			// Put the cursor somewhere useful: first agenda item of a meeting, else after the title.
			const marker = text.indexOf('<<<<<<< ');
			if (useDraft && marker !== -1) {
				ta.value = text;
				ta.setSelectionRange(marker, marker);
			} else if (isNew) {
				const agenda = text.indexOf('  - \n');
				const title = text.indexOf('\n\n');
				const pos = agenda !== -1 ? agenda + 4 : title !== -1 ? title + 2 : text.length;
				ta.setSelectionRange(pos, pos);
			}
			ta.scrollTop = 0;
		}
	});

	$effect(() => {
		const t = text;
		if (t === initial || saved) return;
		const timer = setTimeout(() => {
			try {
				localStorage.setItem(draftKey, JSON.stringify({ text: t, savedAt: Date.now() }));
			} catch {
				/* storage full or unavailable */
			}
		}, 800);
		return () => clearTimeout(timer);
	});

	function clearDraft() {
		try {
			localStorage.removeItem(draftKey);
		} catch {
			/* ignore */
		}
	}

	beforeNavigate((nav) => {
		if (dirty && !saved && !confirm('Hai modifiche non salvate. Uscire comunque? (La bozza resta salvata su questo dispositivo.)')) {
			nav.cancel();
		}
	});

	// ------------------------------------------------------------------ save
	// Saving is local and instant; the sync worker sends it in the background.
	function save() {
		if (!text.trim() && !isNew) {
			deleteOpen = true;
			return;
		}
		if (hasConflictMarkers(text)) {
			toast.show('Ci sono ancora parti in conflitto (<<<<<<< … >>>>>>>): scegli cosa tenere prima di salvare.', { error: true });
			return;
		}
		if (text === initial && !isNew) return;
		sync.save({ id, content: text, base, baseContent, summary, minor });
		saved = true;
		clearDraft();
		toast.show(sync.online ? 'Pagina salvata' : 'Salvata sul dispositivo: verrà sincronizzata appena torni online');
		goto(pageHref(id));
	}

	function deletePage() {
		deleteOpen = false;
		sync.save({ id, content: '', base, baseContent, summary: summary || 'eliminata' });
		saved = true;
		clearDraft();
		toast.show('Pagina eliminata');
		goto(pageHref(getNs(id) || 'start'));
	}

	// --------------------------------------------------------------- editing
	/** Insert text through execCommand so the browser's undo stack keeps working. */
	function insert(str: string, selectFrom?: number, selectTo?: number) {
		ta.focus();
		const start = ta.selectionStart;
		if (!document.execCommand('insertText', false, str)) {
			ta.setRangeText(str, ta.selectionStart, ta.selectionEnd, 'end');
			text = ta.value;
		}
		if (selectFrom !== undefined) ta.setSelectionRange(start + selectFrom, start + (selectTo ?? selectFrom));
	}

	function wrap(before: string, after: string, placeholder: string) {
		const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd) || placeholder;
		insert(before + sel + after, before.length, before.length + sel.length);
	}

	/** Apply `fn` to every line touched by the selection. */
	function eachLine(fn: (line: string, i: number) => string) {
		const v = ta.value;
		const start = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
		let end = v.indexOf('\n', ta.selectionEnd);
		if (end === -1) end = v.length;
		ta.setSelectionRange(start, end);
		const out = v.slice(start, end).split('\n').map(fn).join('\n');
		insert(out, out.length);
	}

	function heading(level: number) {
		const marks = '='.repeat(7 - level);
		eachLine((l) => {
			const clean = l.replace(/^\s*=+\s*|\s*=+\s*$/g, '');
			return `${marks} ${clean || 'Titolo'} ${marks}`;
		});
	}

	function listify(marker: '*' | '-') {
		eachLine((l) => {
			const m = l.match(/^(\s+)([*-]) ?(.*)$/);
			if (m && m[2] === marker) return m[3];
			return `  ${marker} ${m ? m[3] : l}`;
		});
	}

	function insertBlock(block: string) {
		const v = ta.value;
		const before = v.slice(0, ta.selectionStart);
		const pre = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
		insert(pre + block + '\n');
	}

	function onkeydown(e: KeyboardEvent) {
		const mod = e.ctrlKey || e.metaKey;
		if (mod && e.key === 's') {
			e.preventDefault();
			save();
		} else if (mod && e.key === 'b') {
			e.preventDefault();
			wrap('**', '**', 'grassetto');
		} else if (mod && e.key === 'i') {
			e.preventDefault();
			wrap('//', '//', 'corsivo');
		} else if (mod && e.key === 'k') {
			e.preventDefault();
			openLink();
		} else if (e.key === 'Tab') {
			const v = ta.value;
			const lineStart = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
			const line = v.slice(lineStart, v.indexOf('\n', lineStart) === -1 ? v.length : v.indexOf('\n', lineStart));
			const isList = /^\s+[*-]/.test(line);
			if (isList || ta.selectionStart !== ta.selectionEnd) {
				e.preventDefault();
				eachLine((l) => (e.shiftKey ? l.replace(/^ {2}/, '') : `  ${l}`));
			}
		} else if (e.key === 'Enter' && !e.shiftKey && !mod) {
			// Continue lists; an empty item ends the list.
			const v = ta.value;
			const pos = ta.selectionStart;
			const lineStart = v.lastIndexOf('\n', pos - 1) + 1;
			const line = v.slice(lineStart, pos);
			const m = line.match(/^(\s+)([*-]) (\[[ xX]\] )?/);
			if (m && ta.selectionStart === ta.selectionEnd) {
				e.preventDefault();
				if (line.trim() === m[0].trim()) {
					ta.setSelectionRange(lineStart, pos);
					insert('');
				} else {
					insert(`\n${m[1]}${m[2]} ${m[3] ? '[ ] ' : ''}`);
				}
			} else if (/^[|^]/.test(line) && ta.selectionStart === ta.selectionEnd && pos === (v.indexOf('\n', pos) === -1 ? v.length : v.indexOf('\n', pos))) {
				// New table row with the same number of columns.
				e.preventDefault();
				const cols = (line.match(/[|^]/g)?.length ?? 2) - 1;
				insert('\n|' + '  |'.repeat(Math.max(cols, 1)), 2, 2);
			}
		}
	}

	// ----------------------------------------------------------------- media
	async function upload(files: FileList | File[]) {
		for (const file of Array.from(files)) {
			uploading++;
			try {
				const mediaId = await uploadMedia(ns, file);
				const isImage = file.type.startsWith('image/');
				insert(isImage ? `{{${mediaId}?400|}}` : `{{${mediaId}|${file.name}}}`);
				toast.show(`${file.name} caricato`);
			} catch (e) {
				toast.error(e);
			} finally {
				uploading--;
			}
		}
	}

	function onpaste(e: ClipboardEvent) {
		const files = [...(e.clipboardData?.files ?? [])];
		if (files.length) {
			e.preventDefault();
			upload(files);
		}
	}

	function ondrop(e: DragEvent) {
		dragging = false;
		if (e.dataTransfer?.files.length) {
			e.preventDefault();
			upload(e.dataTransfer.files);
		}
	}

	// ----------------------------------------------------------------- links
	let selectionForLink = { start: 0, end: 0, text: '' };
	function openLink() {
		selectionForLink = { start: ta.selectionStart, end: ta.selectionEnd, text: ta.value.slice(ta.selectionStart, ta.selectionEnd) };
		linkQuery = '';
		linkOpen = true;
	}
	const linkResults = $derived.by(() => {
		const q = linkQuery.trim().toLowerCase();
		const list = q ? pageIndex.pages.filter((p) => p.title.toLowerCase().includes(q) || p.id.includes(q)) : pageIndex.recent;
		return list.slice(0, 8);
	});
	function insertLink(target: string) {
		linkOpen = false;
		ta.focus();
		ta.setSelectionRange(selectionForLink.start, selectionForLink.end);
		const label = selectionForLink.text;
		const body = label ? `[[${target}|${label}]]` : `[[${target}]]`;
		insert(body, body.length);
	}

	const tools: { icon: string; label: string; run: () => void; sep?: boolean }[] = [
		{ icon: 'format_bold', label: 'Grassetto (Ctrl+B)', run: () => wrap('**', '**', 'grassetto') },
		{ icon: 'format_italic', label: 'Corsivo (Ctrl+I)', run: () => wrap('//', '//', 'corsivo') },
		{ icon: 'format_underlined', label: 'Sottolineato', run: () => wrap('__', '__', 'sottolineato') },
		{ icon: 'strikethrough_s', label: 'Barrato', run: () => wrap('<del>', '</del>', 'barrato') },
		{ icon: 'code', label: 'Monospazio', run: () => wrap("''", "''", 'codice') },
		{ icon: 'format_h2', label: 'Sezione', run: () => heading(2), sep: true },
		{ icon: 'format_h3', label: 'Sottosezione', run: () => heading(3) },
		{ icon: 'format_list_bulleted', label: 'Elenco puntato', run: () => listify('*'), sep: true },
		{ icon: 'format_list_numbered', label: 'Elenco numerato', run: () => listify('-') },
		{ icon: 'checklist', label: 'Lista di cose da fare', run: () => eachLine((l) => `  * [ ] ${l.replace(/^\s+[*-]\s*(\[[ xX]\]\s*)?/, '')}`) },
		{ icon: 'link', label: 'Link (Ctrl+K)', run: openLink, sep: true },
		{ icon: 'image', label: 'Immagine o file', run: () => fileInput.click() },
		{ icon: 'table', label: 'Tabella', run: () => insertBlock('^ Colonna 1 ^ Colonna 2 ^ Colonna 3 ^\n|   |   |   |\n|   |   |   |') },
		{ icon: 'info', label: 'Nota', run: () => wrap('<note>', '</note>', 'Testo della nota') },
		{ icon: 'horizontal_rule', label: 'Linea', run: () => insertBlock('----') }
	];
</script>

<div class="editor" class:split={preview}>
	<div class="bar">
		<div class="tools" role="toolbar" aria-label="Formattazione">
			{#each tools as t (t.icon)}
				{#if t.sep}<span class="sep"></span>{/if}
				<button class="icon-btn" title={t.label} aria-label={t.label} onmousedown={(e) => e.preventDefault()} onclick={t.run}>
					<span class="icon">{t.icon}</span>
				</button>
			{/each}
		</div>
		<span class="spacer"></span>
		<div class="tabs" role="tablist">
			<button role="tab" class="chip" class:selected={mobileTab === 'write'} aria-selected={mobileTab === 'write'} onclick={() => (mobileTab = 'write')}>Scrivi</button>
			<button role="tab" class="chip" class:selected={mobileTab === 'preview'} aria-selected={mobileTab === 'preview'} onclick={() => (mobileTab = 'preview')}>Anteprima</button>
		</div>
		<button class="icon-btn toggle" class:selected={preview} title="Anteprima affiancata" aria-label="Anteprima affiancata" onclick={() => (preview = !preview)}>
			<span class="icon">vertical_split</span>
		</button>
	</div>

	{#if draft}
		<div class="banner">
			<span class="icon">restore</span>
			<span class="grow body-m">Hai una bozza non salvata di {timeAgo(draft.savedAt)} su questo dispositivo.</span>
			<button class="btn text" onclick={() => { clearDraft(); draft = null; ta.focus(); }}>Scarta</button>
			<button class="btn tonal" onclick={() => { text = draft!.text; draft = null; ta.focus(); }}>Ripristina</button>
		</div>
	{/if}

	<div class="panes" class:show-preview={mobileTab === 'preview'}>
		<div
			class="write"
			class:dragging
			role="presentation"
			ondragover={(e) => { e.preventDefault(); dragging = true; }}
			ondragleave={() => (dragging = false)}
			{ondrop}
		>
			<textarea
				bind:this={ta}
				bind:value={text}
				{onkeydown}
				{onpaste}
				spellcheck="true"
				lang="it"
				aria-label="Testo della pagina"
				placeholder="Scrivi qui… (puoi incollare o trascinare le immagini)"
			></textarea>
			{#if dragging}<div class="drop"><span class="icon">upload</span> Rilascia per caricare</div>{/if}
			{#if uploading}<div class="uploading"><div class="progress"></div><span class="body-s">Caricamento…</span></div>{/if}
		</div>
		<div class="preview">
			<WikiContent text={previewText} pageId={id} />
		</div>
	</div>

	<div class="footer">
		<div class="field summary">
			<input bind:value={summary} placeholder="Cosa hai cambiato? (facoltativo)" aria-label="Riassunto della modifica" maxlength="255" />
		</div>
		{#if !isNew}
			<label class="minor body-m"><input type="checkbox" bind:checked={minor} /> Minore</label>
		{/if}
		<span class="spacer"></span>
		{#if !isNew}
			<button class="icon-btn danger" title="Elimina pagina" aria-label="Elimina pagina" onclick={() => (deleteOpen = true)}>
				<span class="icon">delete</span>
			</button>
		{/if}
		<a class="btn text" href={pageHref(id)}>Annulla</a>
		<button class="btn filled" onclick={() => save()} disabled={uploading > 0 || (!dirty && !isNew)}>
			<span class="icon">check</span>Salva
		</button>
	</div>
</div>

<input bind:this={fileInput} type="file" multiple hidden onchange={() => fileInput.files && upload(fileInput.files)} />

<Dialog bind:open={deleteOpen} title="Eliminare la pagina?" icon="delete">
	<p>La pagina sparirà dal wiki, ma resterà nella cronologia e potrà essere ripristinata.</p>
	{#snippet actions()}
		<button class="btn text" onclick={() => (deleteOpen = false)}>Annulla</button>
		<button class="btn filled danger" onclick={deletePage}>Elimina</button>
	{/snippet}
</Dialog>

<Dialog bind:open={linkOpen} title="Inserisci link">
	<div class="stack">
		<div class="field">
			<!-- svelte-ignore a11y_autofocus -->
			<input
				bind:value={linkQuery}
				placeholder="Cerca una pagina o incolla un indirizzo web"
				autofocus
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						const q = linkQuery.trim();
						if (/^https?:\/\//.test(q)) insertLink(q);
						else if (linkResults[0]) insertLink(linkResults[0].id);
					}
				}}
			/>
		</div>
		<ul class="list">
			{#if /^https?:\/\//.test(linkQuery.trim())}
				<li><button class="list-item" onclick={() => insertLink(linkQuery.trim())}><span class="icon">public</span><span class="grow headline">{linkQuery.trim()}</span></button></li>
			{:else}
				{#each linkResults as p (p.id)}
					<li>
						<button class="list-item" onclick={() => insertLink(p.id)}>
							<span class="icon">article</span>
							<span class="grow"><span class="headline">{p.title}</span><span class="supporting">{p.id}</span></span>
						</button>
					</li>
				{/each}
			{/if}
		</ul>
	</div>
	{#snippet actions()}
		<button class="btn text" onclick={() => (linkOpen = false)}>Annulla</button>
	{/snippet}
</Dialog>

<style>
	.editor {
		display: flex;
		flex-direction: column;
		height: calc(100dvh - var(--topbar-h) - 72px);
		min-height: 420px;
		border: 1px solid var(--md-outline-variant);
		border-radius: var(--md-shape-lg);
		background: var(--md-surface-container-lowest);
		overflow: hidden;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 8px;
		border-bottom: 1px solid var(--md-outline-variant);
		background: var(--md-surface-container-low);
	}
	.tools {
		display: flex;
		align-items: center;
		gap: 0;
		overflow-x: auto;
		scrollbar-width: none;
		min-width: 0;
	}
	.tools .icon-btn {
		width: 36px;
		height: 36px;
	}
	.tools .icon {
		font-size: 20px;
	}
	.sep {
		width: 1px;
		height: 20px;
		margin: 0 4px;
		background: var(--md-outline-variant);
		flex-shrink: 0;
	}
	.tabs {
		display: none;
		gap: 4px;
	}
	.banner {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 8px 8px 16px;
		background: var(--md-warning-container);
		color: var(--md-on-warning-container);
	}
	.banner .grow {
		flex: 1;
	}
	.banner .btn.text {
		color: inherit;
	}
	.panes {
		flex: 1;
		display: grid;
		grid-template-columns: 1fr;
		min-height: 0;
	}
	.split .panes {
		grid-template-columns: 1fr 1fr;
	}
	.write {
		position: relative;
		min-height: 0;
	}
	textarea {
		width: 100%;
		height: 100%;
		padding: 20px 24px;
		border: none;
		resize: none;
		background: transparent;
		color: var(--md-on-surface);
		font-family: var(--font-mono);
		font-size: 14.5px;
		line-height: 1.7;
		tab-size: 2;
	}
	textarea:focus {
		outline: none;
	}
	.dragging textarea {
		background: var(--md-primary-container);
	}
	.drop,
	.uploading {
		position: absolute;
		left: 50%;
		bottom: 16px;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 16px;
		border-radius: var(--md-shape-full);
		background: var(--md-inverse-surface);
		color: var(--md-inverse-on-surface);
		pointer-events: none;
	}
	.uploading .progress {
		width: 80px;
	}
	.preview {
		display: none;
		min-height: 0;
		overflow-y: auto;
		padding: 20px 28px;
		border-left: 1px solid var(--md-outline-variant);
		background: var(--md-surface);
	}
	.split .preview {
		display: block;
	}
	.footer {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border-top: 1px solid var(--md-outline-variant);
		background: var(--md-surface-container-low);
		flex-wrap: wrap;
	}
	.summary {
		flex: 1 1 260px;
		max-width: 480px;
	}
	.summary input {
		min-height: 40px;
		padding: 8px 14px;
		font-size: 14px;
		border-color: var(--md-outline-variant);
		border-radius: var(--md-shape-full);
	}
	.minor {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--md-on-surface-variant);
		cursor: pointer;
	}
	.minor input {
		accent-color: var(--md-primary);
		width: 18px;
		height: 18px;
	}
	.danger {
		color: var(--md-error);
	}
	.btn .icon {
		font-size: 18px;
	}
	.list .list-item {
		min-height: 48px;
	}

	@media (max-width: 960px) {
		.editor {
			height: calc(100dvh - var(--topbar-h) - 56px);
			border-radius: var(--md-shape-md);
		}
		.toggle {
			display: none;
		}
		.tabs {
			display: flex;
		}
		.split .panes,
		.panes {
			grid-template-columns: 1fr;
		}
		.split .preview,
		.preview {
			display: none;
			border-left: none;
		}
		.panes.show-preview .preview {
			display: block;
		}
		.panes.show-preview .write {
			display: none;
		}
		textarea {
			padding: 16px;
			font-size: 15px;
		}
		.summary {
			flex-basis: 100%;
			max-width: none;
		}
	}
</style>
