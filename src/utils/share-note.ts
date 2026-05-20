import * as iconv from 'iconv-lite';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const execFileAsync = promisify(execFile);

export const MAX_BODY_LENGTH = 2000;

/**
 * Converts markdown syntax into structured plain text suitable for email bodies.
 * Headings get ASCII underlines, bullets become •, code blocks are indented 4 spaces,
 * links show as "text (url)", blockquotes as "| text".
 */
export const markdownToPlainText = (markdown: string): string => {
	if (!markdown) return '';
	const lines = markdown.split('\n');
	const output: string[] = [];
	let inCodeBlock = false;

	for (const line of lines) {
		const codeFenceMatch = line.match(/^```(\w*)$/);
		if (codeFenceMatch) {
			inCodeBlock = !inCodeBlock;
			continue;
		}

		if (inCodeBlock) {
			output.push(`    ${line}`);
			continue;
		}

		const h1Match = line.match(/^# (.+)$/);
		if (h1Match) {
			const text = h1Match[1];
			output.push(text);
			output.push('='.repeat(text.length));
			continue;
		}

		const h2Match = line.match(/^## (.+)$/);
		if (h2Match) {
			const text = h2Match[1];
			output.push(text);
			output.push('-'.repeat(text.length));
			continue;
		}

		const h3Match = line.match(/^#{3,6} (.+)$/);
		if (h3Match) {
			output.push(h3Match[1]);
			continue;
		}

		if (/^[-*_]{3,}$/.test(line.trim())) {
			output.push('─'.repeat(40));
			continue;
		}

		const bulletMatch = line.match(/^(\s*)[-*+] (.+)$/);
		if (bulletMatch) {
			output.push(`${bulletMatch[1]}• ${bulletMatch[2]}`);
			continue;
		}

		const numberedMatch = line.match(/^(\s*)\d+\. (.+)$/);
		if (numberedMatch) {
			output.push(`${numberedMatch[1]}• ${numberedMatch[2]}`);
			continue;
		}

		const blockquoteMatch = line.match(/^> (.+)$/);
		if (blockquoteMatch) {
			output.push(`| ${blockquoteMatch[1]}`);
			continue;
		}

		let processed = line;
		processed = processed.replace(/`([^`]+)`/g, '$1');
		processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
		processed = processed.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
		processed = processed.replace(/\*\*([^*]+)\*\*/g, '$1');
		processed = processed.replace(/__([^_]+)__/g, '$1');
		processed = processed.replace(/\*([^*]+)\*/g, '$1');
		processed = processed.replace(/_([^_]+)_/g, '$1');
		processed = processed.replace(/~~([^~]+)~~/g, '$1');

		output.push(processed);
	}

	return output.join('\n').replace(/^\n+|\n+$/g, '');
};

/**
 * Builds a mailto: URL pre-filled with the note title as subject and
 * the plain-text body (truncated if necessary).
 */
export const buildTextMailtoUrl = (title: string, body: string): string => {
	const plainBody = markdownToPlainText(body);
	const truncated =
		plainBody.length > MAX_BODY_LENGTH
			? `${plainBody.slice(0, MAX_BODY_LENGTH)}\n\n[…truncated — ${plainBody.length - MAX_BODY_LENGTH} more chars]`
			: plainBody;
	return `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(truncated)}`;
};

/**
 * Builds a mailto: URL pre-filled for a PDF share.
 * Subject is the note title; body reminds the user to attach the saved PDF.
 */
export const buildPdfMailtoUrl = (title: string): string => {
	const body = `Please find the PDF export of "${title}" attached.\n\n(Attach the PDF saved by Joplin to this email.)`;
	return `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
};

/**
 * Opens a URL using the OS default handler (open / start / xdg-open).
 */
export const openUrlInSystem = async (url: string): Promise<void> => {
	const platform = os.platform();
	if (platform === 'darwin') {
		await execFileAsync('open', [url]);
	} else if (platform === 'win32') {
		await execFileAsync('cmd', ['/c', 'start', '', url]);
	} else {
		await execFileAsync('xdg-open', [url]);
	}
};

/**
 * Shares a note as plain text via the default email client.
 */
export const shareNoteAsText = async (note: { title: string; body: string }): Promise<void> => {
	const url = buildTextMailtoUrl(note.title, note.body);
	await openUrlInSystem(url);
};

const sanitizeFilename = (title: string): string => {
	const cleaned = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
	return cleaned || 'note';
};

/**
 * Exports a note's markdown body to DOCX or RTF via pandoc.
 * Writes markdown to a temp file, runs pandoc, and returns the output path.
 */
export const exportNoteWithPandoc = async (opts: {
	title: string;
	body: string;
	format: 'docx' | 'rtf';
}): Promise<string> => {
	const tmpDir = os.tmpdir();
	const safeName = sanitizeFilename(opts.title);
	const inputPath = path.join(tmpDir, `${safeName}.md`);
	const outputPath = path.join(tmpDir, `${safeName}.${opts.format}`);
	await fs.promises.writeFile(inputPath, opts.body, 'utf-8');
	await execFileAsync('pandoc', [inputPath, '--standalone', '-o', outputPath]);
	return outputPath;
};

// Codepages pandoc's RTF reader doesn't support — needs pre-conversion to Unicode escapes.
const RTF_CODEPAGE_ENCODINGS: Record<number, string> = {
	874: 'windows-874',
	1250: 'windows-1250',
	1251: 'windows-1251',
	1253: 'windows-1253',
	1254: 'windows-1254',
	1255: 'windows-1255',
	1256: 'windows-1256',
	1257: 'windows-1257',
	1258: 'windows-1258',
};

// Rewrites \'XX byte escapes to \uN? RTF Unicode escapes so pandoc handles them correctly.
export function fixRtfCodepage(buf: Buffer): Buffer {
	const rtf = buf.toString('latin1');
	const cpMatch = rtf.match(/\\ansicpg(\d+)/);
	if (!cpMatch) return buf;

	const codepage = parseInt(cpMatch[1], 10);
	const encoding = RTF_CODEPAGE_ENCODINGS[codepage];
	if (!encoding) return buf;

	const byteMap = new Map<number, number>();
	for (let b = 0x80; b <= 0xff; b++) {
		const cp = iconv.decode(Buffer.from([b]), encoding).codePointAt(0);
		if (cp !== undefined) byteMap.set(b, cp);
	}

	const fixed = rtf.replace(/\\'([0-9a-fA-F]{2})/g, (match, hex) => {
		const b = parseInt(hex, 16);
		if (b < 0x80) return match;
		const unicode = byteMap.get(b);
		if (unicode === undefined) return match;
		// RTF unicode value is signed 16-bit; chars above U+7FFF use two's complement
		const rtfN = unicode > 32767 ? unicode - 65536 : unicode;
		return `\\u${rtfN}?`;
	});

	return Buffer.from(fixed.replace(/\\ansicpg\d+/, '\\ansicpg1252'), 'latin1');
}

/**
 * Imports a document (DOCX, RTF, or MD) to Markdown via pandoc.
 * Writes content to a temp file, runs pandoc -t markdown, returns the result.
 * Cleans up temp files on completion.
 */
export const importNoteWithPandoc = async (opts: {
	content: Buffer;
	format: 'docx' | 'rtf' | 'md';
	filename: string;
}): Promise<string> => {
	const tmpDir = os.tmpdir();
	const base = sanitizeFilename(opts.filename.replace(/\.[^.]+$/, '') || 'import');
	const inputPath = path.join(tmpDir, `${base}-import.${opts.format}`);
	const outputPath = path.join(tmpDir, `${base}-import-out.md`);
	const content = opts.format === 'rtf' ? fixRtfCodepage(opts.content) : opts.content;
	await fs.promises.writeFile(inputPath, content);
	await execFileAsync('pandoc', [inputPath, '-t', 'gfm', '--wrap=none', '-o', outputPath]);
	const markdown = await fs.promises.readFile(outputPath, 'utf-8');
	await Promise.allSettled([fs.promises.unlink(inputPath), fs.promises.unlink(outputPath)]);
	return markdown;
};

/**
 * Copies a file into a target directory, preserving the original filename.
 * Returns the full path of the destination file.
 */
export const copyFileToDirectory = async (
	sourcePath: string,
	targetDir: string,
): Promise<string> => {
	const filename = path.basename(sourcePath);
	const destPath = path.join(targetDir, filename);
	await fs.promises.copyFile(sourcePath, destPath);
	return destPath;
};
