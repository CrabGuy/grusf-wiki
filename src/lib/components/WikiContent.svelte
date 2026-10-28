<script lang="ts">
	import { render, type Heading } from '#lib/dokuwiki.ts';
	import { mediaUrls, pageHref, pageIndex } from '#lib/wiki.svelte.ts';

	let {
		text,
		pageId,
		headings = $bindable([])
	}: { text: string; pageId: string; headings?: Heading[] } = $props();

	const result = $derived(render(text, { pageId, pageHref, exists: pageIndex.exists }));
	let el: HTMLElement;

	$effect(() => {
		headings = result.headings;
	});

	// Private media need signed URLs: fill them in after each render.
	$effect(() => {
		void result.html;
		const imgs = [...el.querySelectorAll<HTMLImageElement>('img[data-media]')];
		const links = [...el.querySelectorAll<HTMLAnchorElement>('a[data-media-link]')];
		const ids = [...imgs.map((i) => i.dataset.media!), ...links.map((a) => a.dataset.mediaLink!)];
		if (!ids.length) return;
		mediaUrls(ids).then((urls) => {
			for (const img of imgs) {
				const url = urls.get(img.dataset.media!);
				if (url) img.src = url;
				else img.classList.add('broken');
			}
			for (const a of links) {
				const url = urls.get(a.dataset.mediaLink!);
				if (url) {
					a.href = url;
					a.target = '_blank';
					a.rel = 'noopener';
				}
			}
		});
	});
</script>

<article class="wiki" bind:this={el}>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- output of our escaping renderer -->
	{@html result.html}
</article>

<style>
	.wiki {
		font-size: 16px;
		line-height: 1.65;
		overflow-wrap: anywhere;
	}
	.wiki :global(h1) {
		font-size: 32px;
		line-height: 40px;
		font-weight: 400;
		margin: 0 0 24px;
		letter-spacing: -0.25px;
	}
	.wiki :global(h2) {
		font-size: 24px;
		line-height: 32px;
		font-weight: 450;
		margin: 40px 0 12px;
		padding-bottom: 8px;
		border-bottom: 1px solid var(--md-outline-variant);
	}
	.wiki :global(h3) {
		font-size: 20px;
		line-height: 28px;
		font-weight: 500;
		margin: 32px 0 8px;
	}
	.wiki :global(h4),
	.wiki :global(h5),
	.wiki :global(h6) {
		font-size: 16px;
		font-weight: 600;
		margin: 24px 0 8px;
	}
	.wiki :global(h1:first-child),
	.wiki :global(h2:first-child) {
		margin-top: 0;
	}
	.wiki :global(:is(h1, h2, h3, h4, h5, h6)) {
		scroll-margin-top: calc(var(--topbar-h) + 16px);
	}
	.wiki :global(p) {
		margin: 0 0 16px;
	}
	.wiki :global(ul),
	.wiki :global(ol) {
		margin: 0 0 16px;
		padding-left: 28px;
	}
	.wiki :global(li) {
		margin: 4px 0;
	}
	.wiki :global(li > ul),
	.wiki :global(li > ol) {
		margin: 4px 0;
	}
	.wiki :global(li::marker) {
		color: var(--md-primary);
	}
	.wiki :global(li.tasklist) {
		list-style: none;
		margin-left: -24px;
		display: flex;
		gap: 8px;
		align-items: baseline;
	}
	.wiki :global(.task) {
		flex-shrink: 0;
		width: 18px;
		height: 18px;
		border: 2px solid var(--md-on-surface-variant);
		border-radius: 3px;
		transform: translateY(3px);
	}
	.wiki :global(.task.done) {
		background: var(--md-primary);
		border-color: var(--md-primary);
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23fffaf3' d='M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z'/%3E%3C/svg%3E");
		background-size: 14px;
		background-position: center;
		background-repeat: no-repeat;
	}
	.wiki :global(a) {
		color: var(--md-primary);
		text-decoration: underline;
		text-decoration-color: color-mix(in srgb, var(--md-primary) 35%, transparent);
		text-underline-offset: 3px;
	}
	.wiki :global(a:hover) {
		text-decoration-color: currentColor;
	}
	.wiki :global(a.wikilink2) {
		color: var(--md-error);
		text-decoration-style: dashed;
	}
	.wiki :global(a.urlextern::after) {
		content: 'open_in_new';
		font-family: 'Material Symbols Rounded';
		font-size: 14px;
		margin-left: 2px;
		vertical-align: -1px;
	}
	.wiki :global(a.medialink),
	.wiki :global(a.medialink:hover) {
		text-decoration: none;
	}
	.wiki :global(a.mediafile::before) {
		content: 'attach_file';
		font-family: 'Material Symbols Rounded';
		font-size: 18px;
		margin-right: 2px;
		vertical-align: -3px;
	}
	.wiki :global(strong) {
		font-weight: 650;
	}
	.wiki :global(code) {
		font-family: var(--font-mono);
		font-size: 0.875em;
		padding: 2px 6px;
		border-radius: var(--md-shape-xs);
		background: var(--md-surface-container);
	}
	.wiki :global(.codeblock) {
		margin: 0 0 16px;
		border-radius: var(--md-shape-md);
		background: var(--md-surface-container);
		overflow: hidden;
	}
	.wiki :global(.codeblock .filename) {
		padding: 8px 16px;
		font-size: 13px;
		font-weight: 500;
		background: var(--md-surface-container-high);
	}
	.wiki :global(pre) {
		margin: 0;
		padding: 16px;
		overflow-x: auto;
		font-family: var(--font-mono);
		font-size: 14px;
		line-height: 1.55;
	}
	.wiki :global(pre code) {
		padding: 0;
		background: none;
		font-size: inherit;
	}
	.wiki :global(pre.pre) {
		margin: 0 0 16px;
		border-radius: var(--md-shape-md);
		background: var(--md-surface-container);
	}
	.wiki :global(blockquote) {
		margin: 0 0 16px;
		padding: 4px 0 4px 16px;
		border-left: 4px solid var(--md-secondary);
		color: var(--md-on-surface-variant);
	}
	.wiki :global(blockquote p:last-child) {
		margin-bottom: 0;
	}
	.wiki :global(hr) {
		border: none;
		height: 1px;
		background: var(--md-outline-variant);
		margin: 32px 0;
	}
	.wiki :global(.table-wrap) {
		overflow-x: auto;
		margin: 0 0 16px;
		border: 1px solid var(--md-outline-variant);
		border-radius: var(--md-shape-md);
	}
	.wiki :global(table) {
		border-collapse: collapse;
		width: 100%;
		font-size: 15px;
	}
	.wiki :global(th),
	.wiki :global(td) {
		padding: 10px 14px;
		text-align: left;
		vertical-align: top;
		border-bottom: 1px solid var(--md-outline-variant);
	}
	.wiki :global(tr:last-child > *) {
		border-bottom: none;
	}
	.wiki :global(th) {
		background: var(--md-surface-container-low);
		font-weight: 600;
		white-space: nowrap;
	}
	.wiki :global(td + td),
	.wiki :global(th + td),
	.wiki :global(td + th),
	.wiki :global(th + th) {
		border-left: 1px solid var(--md-outline-variant);
	}
	.wiki :global(.right) {
		text-align: right;
	}
	.wiki :global(.center) {
		text-align: center;
	}
	.wiki :global(img.media) {
		max-width: 100%;
		height: auto;
		border-radius: var(--md-shape-md);
		vertical-align: middle;
		background: var(--md-surface-container);
	}
	.wiki :global(img.broken) {
		min-width: 48px;
		min-height: 48px;
		outline: 1px dashed var(--md-error);
	}
	.wiki :global(img.mediacenter) {
		display: block;
		margin: 8px auto;
	}
	.wiki :global(img.mediaright) {
		float: right;
		margin: 0 0 8px 16px;
	}
	.wiki :global(img.medialeft) {
		float: left;
		margin: 0 16px 8px 0;
	}
	.wiki :global(.note) {
		position: relative;
		margin: 0 0 16px;
		padding: 16px 16px 16px 52px;
		border-radius: var(--md-shape-md);
		background: var(--md-primary-container);
		color: var(--md-on-primary-container);
	}
	.wiki :global(.note::before) {
		content: 'info';
		position: absolute;
		left: 16px;
		top: 15px;
		font-family: 'Material Symbols Rounded';
		font-size: 24px;
		line-height: 1;
	}
	.wiki :global(.note p:last-child) {
		margin-bottom: 0;
	}
	.wiki :global(.note-tip) {
		background: var(--md-secondary-container);
		color: var(--md-on-secondary-container);
	}
	.wiki :global(.note-tip::before) {
		content: 'lightbulb';
	}
	.wiki :global(.note-important) {
		background: var(--md-warning-container);
		color: var(--md-on-warning-container);
	}
	.wiki :global(.note-important::before) {
		content: 'priority_high';
	}
	.wiki :global(.note-warning) {
		background: var(--md-error-container);
		color: var(--md-on-error-container);
	}
	.wiki :global(.note-warning::before) {
		content: 'warning';
	}
	.wiki :global(.wrap) {
		margin: 0 0 16px;
	}
	.wiki :global(.unsupported) {
		font-family: var(--font-mono);
		font-size: 13px;
		color: var(--md-outline);
	}
	.wiki :global(.footnotes) {
		margin-top: 40px;
		padding-top: 16px;
		border-top: 1px solid var(--md-outline-variant);
		font-size: 14px;
		color: var(--md-on-surface-variant);
	}
	.wiki :global(sup a) {
		text-decoration: none;
	}
	.wiki::after {
		content: '';
		display: table;
		clear: both;
	}
</style>
