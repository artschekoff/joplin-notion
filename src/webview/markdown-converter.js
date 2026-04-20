/**
 * markdown-converter.js
 *
 * Bidirectional conversion between Joplin's Markdown and Editor.js block format.
 * Exposed as window.MarkdownConverter = { markdownToBlocks, blocksToMarkdown }.
 *
 * Inline formatting (bold, italic, code, links, strikethrough) is converted
 * between Markdown syntax and the HTML tags that Editor.js uses internally,
 * so notes round-trip cleanly when switching between editors.
 */

/* global window */

// ── Backslash escape helpers ──────────────────────────────────────────────

const ESCAPE_PLACEHOLDER = '\x00ESC';
const ESCAPE_RE = /\\([\\`*_~\[\]()#+\-.!])/g;
const PLACEHOLDER_RE = new RegExp(ESCAPE_PLACEHOLDER + '(..)', 'g');

const protectEscapes = (text) =>
	text.replace(ESCAPE_RE, (_, ch) => ESCAPE_PLACEHOLDER + ch.charCodeAt(0).toString(16).padStart(2, '0'));

const restoreEscapes = (text) =>
	text.replace(PLACEHOLDER_RE, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

// ── Inline: Markdown → HTML ───────────────────────────────────────────────

const mdInlineToHtml = (md) => {
	if (!md) return '';
	let s = protectEscapes(md);
	s = s
		.replace(/&(?!(?:amp|lt|gt|quot|#\d+|#x[\da-f]+);)/gi, '&amp;')
		.replace(/`([^`]+)`/g, '<code>$1</code>')
		.replace(/\*\*(.+?)\*\*/gs, '<b>$1</b>')
		.replace(/__(.+?)__/gs, '<b>$1</b>')
		.replace(/\*(.+?)\*/gs, '<i>$1</i>')
		.replace(/_([^_]+)_/gs, '<i>$1</i>')
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
		.replace(/~~(.+?)~~/gs, '<s>$1</s>');
	return restoreEscapes(s);
};

// ── Inline: HTML → Markdown ───────────────────────────────────────────────

/**
 * Escape runs of underscores (2+) that would be misinterpreted as bold/italic
 * when the plain text is converted back from HTML to Markdown.
 */
const escapeMarkdownSpecials = (text) =>
	text.replace(/_{2,}/g, (m) => m.split('').map((ch) => `\\${ch}`).join(''));

const htmlInlineToMd = (html) => {
	if (!html) return '';
	let s = html
		.replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**')
		.replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**')
		.replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*')
		.replace(/<em>([\s\S]*?)<\/em>/gi, '*$1*')
		.replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`')
		.replace(/<s>([\s\S]*?)<\/s>/gi, '~~$1~~')
		.replace(/<del>([\s\S]*?)<\/del>/gi, '~~$1~~')
		.replace(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
		.replace(/<[^>]+>/g, '')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"');
	return escapeMarkdownSpecials(s);
};

// ── Markdown → Editor.js blocks ───────────────────────────────────────────

/**
 * Convert a Markdown string to an array of Editor.js block objects.
 * Consecutive list items of the same style are merged into one list block.
 */
const markdownToBlocks = (markdown) => {
	if (!markdown) return [];

	const lines = markdown.split('\n');
	const blocks = [];

	let inCodeBlock = false;
	let codeLang = '';
	let codeLines = [];

	const flushCode = () => {
		if (codeLines.length > 0) {
			blocks.push({ type: 'code', data: { code: codeLines.join('\n') } });
		}
		codeLines = [];
		codeLang = '';
		inCodeBlock = false;
	};

	// Merge consecutive same-type list items into the last block
	const pushListItem = (style, itemHtml) => {
		const last = blocks[blocks.length - 1];
		if (last && last.type === 'list' && last.data.style === style) {
			last.data.items.push(itemHtml);
		} else {
			blocks.push({ type: 'list', data: { style, items: [itemHtml] } });
		}
	};

	const pushChecklistItem = (checked, itemHtml) => {
		const last = blocks[blocks.length - 1];
		if (last && last.type === 'checklist') {
			last.data.items.push({ text: itemHtml, checked });
		} else {
			blocks.push({ type: 'checklist', data: { items: [{ text: itemHtml, checked }] } });
		}
	};

	/** Detect a markdown table separator row (e.g. `| --- | :---: | ---: |`). */
	const isTableSeparator = (l) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);

	/** Split a pipe-delimited table row into trimmed cell strings. */
	const parseTableRow = (l, colCount) => {
		let inner = l.trim();
		if (inner.startsWith('|')) inner = inner.slice(1);
		if (inner.endsWith('|')) inner = inner.slice(0, -1);
		const cells = inner.split('|').map((c) => c.trim());
		while (cells.length < colCount) cells.push('');
		return cells;
	};

	/** Check whether a line looks like a pipe-delimited table row. */
	const isTableRow = (l) => l.trim().includes('|');

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// ── fenced code block ───────────────────────────────────────────────
		if (/^```/.test(line)) {
			if (inCodeBlock) {
				flushCode();
			} else {
				inCodeBlock = true;
				codeLang = line.slice(3).trim();
			}
			continue;
		}
		if (inCodeBlock) {
			codeLines.push(line);
			continue;
		}

		// ── heading ─────────────────────────────────────────────────────────
		const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
		if (headingMatch) {
			blocks.push({
				type: 'header',
				data: {
					level: headingMatch[1].length,
					text: mdInlineToHtml(headingMatch[2].trim()),
				},
			});
			continue;
		}

		// ── horizontal rule ─────────────────────────────────────────────────
		if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) {
			blocks.push({ type: 'delimiter', data: {} });
			continue;
		}

		// ── markdown table ──────────────────────────────────────────────────
		if (
			isTableRow(line) &&
			i + 1 < lines.length &&
			isTableSeparator(lines[i + 1])
		) {
			const headerCells = parseTableRow(line, 0);
			const colCount = headerCells.length;
			i += 1; // skip separator row
			const content = [headerCells.map((c) => mdInlineToHtml(c))];
			while (i + 1 < lines.length && isTableRow(lines[i + 1]) && !isTableSeparator(lines[i + 1])) {
				i += 1;
				content.push(parseTableRow(lines[i], colCount).map((c) => mdInlineToHtml(c)));
			}
			blocks.push({ type: 'table', data: { withHeadings: true, content } });
			continue;
		}

		// ── blockquote ──────────────────────────────────────────────────────
		const quoteMatch = line.match(/^>\s*(.*)/);
		if (quoteMatch) {
			blocks.push({
				type: 'quote',
				data: { text: mdInlineToHtml(quoteMatch[1].trim()), caption: '' },
			});
			continue;
		}

		// ── checklist ───────────────────────────────────────────────────────
		const checkMatch = line.match(/^[-*+]\s+\[([ xX])\]\s+(.*)/);
		if (checkMatch) {
			const checked = checkMatch[1].toLowerCase() === 'x';
			pushChecklistItem(checked, mdInlineToHtml(checkMatch[2].trim()));
			continue;
		}

		// ── unordered list ──────────────────────────────────────────────────
		const ulMatch = line.match(/^[-*+]\s+(.*)/);
		if (ulMatch) {
			pushListItem('unordered', mdInlineToHtml(ulMatch[1].trim()));
			continue;
		}

		// ── ordered list ────────────────────────────────────────────────────
		const olMatch = line.match(/^\d+\.\s+(.*)/);
		if (olMatch) {
			pushListItem('ordered', mdInlineToHtml(olMatch[1].trim()));
			continue;
		}

		// ── blank line → skip (no empty paragraph blocks) ───────────────────
		if (line.trim() === '') {
			continue;
		}

		// ── paragraph ───────────────────────────────────────────────────────
		blocks.push({ type: 'paragraph', data: { text: mdInlineToHtml(line) } });
	}

	// Flush any unclosed code block
	if (inCodeBlock) flushCode();

	return blocks;
};

// ── Editor.js blocks → Markdown ───────────────────────────────────────────

/**
 * Read text from an Editor.js list item.
 * Handles both plain string (input format) and v2 object { content, items } (output format).
 */
const listItemText = (item) => {
	const raw = typeof item === 'string' ? item : (item.content ?? item.text ?? '');
	return htmlInlineToMd(raw);
};

/**
 * Convert an array of Editor.js block objects back to a Markdown string.
 */
const blocksToMarkdown = (blocks) => {
	if (!blocks || !blocks.length) return '';

	const parts = [];

	for (const block of blocks) {
		const d = block.data || {};

		switch (block.type) {
			case 'header': {
				const level = Math.min(Math.max(d.level || 1, 1), 6);
				parts.push('#'.repeat(level) + ' ' + htmlInlineToMd(d.text || ''));
				break;
			}

			case 'paragraph':
				parts.push(htmlInlineToMd(d.text || ''));
				break;

			case 'list': {
				const items = d.items || [];
				if (d.style === 'ordered') {
					items.forEach((item, idx) => {
						parts.push(`${idx + 1}. ${listItemText(item)}`);
					});
				} else {
					items.forEach((item) => {
						parts.push(`- ${listItemText(item)}`);
					});
				}
				break;
			}

			case 'checklist': {
				const items = d.items || [];
				items.forEach((item) => {
					const checked = item.checked ? 'x' : ' ';
					const text = htmlInlineToMd(item.text || item.content || '');
					parts.push(`- [${checked}] ${text}`);
				});
				break;
			}

			case 'code':
				parts.push('```\n' + (d.code || '') + '\n```');
				break;

			case 'quote':
				parts.push('> ' + htmlInlineToMd(d.text || ''));
				break;

			case 'table': {
				const rows = d.content || [];
				if (rows.length === 0) break;
				const colCount = Math.max(...rows.map((r) => r.length));
				const fmtRow = (cells) =>
					'| ' + Array.from({ length: colCount }, (_, ci) => htmlInlineToMd(cells[ci] || '')).join(' | ') + ' |';
				const tableLines = [];
				if (d.withHeadings && rows.length > 0) {
					tableLines.push(fmtRow(rows[0]));
					tableLines.push('| ' + Array.from({ length: colCount }, () => '---').join(' | ') + ' |');
					rows.slice(1).forEach((r) => tableLines.push(fmtRow(r)));
				} else {
					rows.forEach((r) => tableLines.push(fmtRow(r)));
				}
				parts.push(tableLines.join('\n'));
				break;
			}

			case 'delimiter':
				parts.push('---');
				break;

			default:
				// Unknown block type — try to extract any text content
				if (d.text) parts.push(htmlInlineToMd(d.text));
				break;
		}
	}

	return parts.join('\n\n');
};

// ── Expose globally ───────────────────────────────────────────────────────
window.MarkdownConverter = { markdownToBlocks, blocksToMarkdown };
