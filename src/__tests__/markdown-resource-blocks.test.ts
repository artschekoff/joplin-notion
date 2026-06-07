/* eslint-disable @typescript-eslint/no-require-imports */
const { markdownToBlocks, blocksToMarkdown } = require('../webview/markdown-converter') as {
	markdownToBlocks: (md: string) => Array<{ type: string; data: Record<string, unknown> }>;
	blocksToMarkdown: (blocks: Array<{ type: string; data: Record<string, unknown> }>) => string;
};

describe('markdownToBlocks — image resource lines', () => {
	it('parses a bare image resource line into an image block', () => {
		const blocks = markdownToBlocks('![my-photo.png](:/abc123def456abc1)');
		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe('image');
		expect(blocks[0].data.resourceId).toBe('abc123def456abc1');
		expect(blocks[0].data.title).toBe('my-photo.png');
	});

	it('ignores regular markdown images (non-resource URLs)', () => {
		const blocks = markdownToBlocks('![alt](https://example.com/img.png)');
		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe('paragraph');
	});

	it('treats an image resource line with empty alt as image block', () => {
		const blocks = markdownToBlocks('![](:/abc123)');
		expect(blocks[0].type).toBe('image');
		expect(blocks[0].data.title).toBe('');
	});
});

describe('markdownToBlocks — file resource lines', () => {
	it('parses a bare file resource link into a file block', () => {
		const blocks = markdownToBlocks('[report.pdf](:/deadbeef1234)');
		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe('file');
		expect(blocks[0].data.resourceId).toBe('deadbeef1234');
		expect(blocks[0].data.title).toBe('report.pdf');
	});

	it('ignores regular markdown links (non-resource URLs)', () => {
		const blocks = markdownToBlocks('[Click here](https://example.com)');
		expect(blocks[0].type).toBe('paragraph');
	});

	it('does not treat an image resource line as a file block', () => {
		const blocks = markdownToBlocks('![photo.jpg](:/abc123)');
		expect(blocks[0].type).toBe('image');
		expect(blocks[0].type).not.toBe('file');
	});
});
