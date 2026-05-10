import { convertToMarkdown } from '../import/converter';

describe('convertToMarkdown', () => {
	it('passes markdown through unchanged', async () => {
		const buf = Buffer.from('# My Title\n\nSome **bold** text.');
		const result = await convertToMarkdown(buf, 'md', 'test.md');
		expect(result.markdown).toBe('# My Title\n\nSome **bold** text.');
		expect(result.title).toBe('My Title');
	});

	it('handles .markdown extension same as .md', async () => {
		const buf = Buffer.from('# Another\n\nBody.');
		const result = await convertToMarkdown(buf, 'markdown', 'test.markdown');
		expect(result.title).toBe('Another');
	});

	it('converts plain text', async () => {
		const buf = Buffer.from('Hello World\nSecond line');
		const result = await convertToMarkdown(buf, 'txt', 'hello.txt');
		expect(result.markdown).toContain('Hello World');
		expect(result.title).toBe('Hello World');
	});

	it('uses first heading as title in txt', async () => {
		const buf = Buffer.from('# Heading Here\n\nParagraph.');
		const result = await convertToMarkdown(buf, 'txt', 'file.txt');
		expect(result.title).toBe('Heading Here');
	});

	it('falls back to first line as title when no heading', async () => {
		const buf = Buffer.from('Just a sentence\nSecond line');
		const result = await convertToMarkdown(buf, 'txt', 'file.txt');
		expect(result.title).toBe('Just a sentence');
	});

	it('throws on unsupported format', async () => {
		await expect(convertToMarkdown(Buffer.from('x'), 'xyz', 'file.xyz')).rejects.toThrow(
			'Unsupported format: xyz',
		);
	});
});
