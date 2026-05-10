// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse: (
	buf: Buffer,
) => Promise<{ text: string; info: Record<string, unknown> }> = require('pdf-parse');
import { importNoteWithPandoc } from '../utils/share-note';

export interface ConvertResult {
	markdown: string;
	title: string;
}

function extractTitle(markdown: string, fallback = 'Imported Note'): string {
	const headingMatch = markdown.match(/^#\s+(.+)$/m);
	if (headingMatch) return headingMatch[1].trim();
	const firstLine = markdown.split('\n')[0]?.trim();
	return firstLine || fallback;
}

async function convertDocx(buf: Buffer, filename: string): Promise<ConvertResult> {
	const markdown = await importNoteWithPandoc({ content: buf, format: 'docx', filename });
	return { markdown, title: extractTitle(markdown, filename.replace(/\.docx$/i, '')) };
}

async function convertRtf(buf: Buffer, filename: string): Promise<ConvertResult> {
	const markdown = await importNoteWithPandoc({ content: buf, format: 'rtf', filename });
	return { markdown, title: extractTitle(markdown, filename.replace(/\.rtf$/i, '')) };
}

async function convertPdf(buf: Buffer, filename: string): Promise<ConvertResult> {
	const data = await pdfParse(buf);
	const pdfTitle = (data.info?.Title as string | undefined)?.trim();
	const markdown = data.text.trim();
	const title =
		pdfTitle && pdfTitle.length > 0
			? pdfTitle
			: extractTitle(markdown, filename.replace(/\.pdf$/i, ''));
	return { markdown, title };
}

function convertText(buf: Buffer, filename: string): ConvertResult {
	const markdown = buf.toString('utf8').trim();
	return { markdown, title: extractTitle(markdown, filename.replace(/\.[^.]+$/, '')) };
}

function convertMarkdown(buf: Buffer, filename: string): ConvertResult {
	const markdown = buf.toString('utf8');
	return { markdown, title: extractTitle(markdown, filename.replace(/\.mdx?$|\.markdown$/i, '')) };
}

export async function convertToMarkdown(
	buf: Buffer,
	ext: string,
	filename: string,
): Promise<ConvertResult> {
	switch (ext.toLowerCase()) {
		case 'docx':
			return convertDocx(buf, filename);
		case 'rtf':
			return convertRtf(buf, filename);
		case 'pdf':
			return convertPdf(buf, filename);
		case 'txt':
			return convertText(buf, filename);
		case 'md':
		case 'markdown':
			return convertMarkdown(buf, filename);
		default:
			throw new Error(`Unsupported format: ${ext}`);
	}
}
