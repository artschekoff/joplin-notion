import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * Read src/panel.ts and extract the PANEL_HTML template string.
 * Works by finding the backtick-delimited template assigned to PANEL_HTML.
 */
const extractPanelHtml = (): string => {
	const src = fs.readFileSync(path.join(ROOT, 'src', 'panel.ts'), 'utf-8');
	const startMarker = 'const PANEL_HTML = `';
	const startIdx = src.indexOf(startMarker);
	if (startIdx === -1) throw new Error('PANEL_HTML not found in panel.ts');
	const contentStart = startIdx + startMarker.length;
	const endIdx = src.indexOf('`;', contentStart);
	if (endIdx === -1) throw new Error('PANEL_HTML closing backtick not found');
	return src.slice(contentStart, endIdx);
};

describe('title field — panel HTML', () => {
	const html = extractPanelHtml();

	it('should contain a title input element with id "note-title"', () => {
		expect(html).toMatch(/id=["']note-title["']/);
	});

	it('should place the title input inside #app before #editor-wrapper', () => {
		const titleIdx = html.indexOf('note-title');
		const editorWrapperIdx = html.indexOf('editor-wrapper');
		expect(titleIdx).toBeGreaterThan(-1);
		expect(editorWrapperIdx).toBeGreaterThan(-1);
		expect(titleIdx).toBeLessThan(editorWrapperIdx);
	});

	it('should have a placeholder on the title input', () => {
		expect(html).toMatch(/id=["']note-title["'][^>]*placeholder=/);
	});
});

describe('title field — panel.ts message handler', () => {
	const panelSrc = fs.readFileSync(path.join(ROOT, 'src', 'panel.ts'), 'utf-8');

	it('should handle saveTitle message type', () => {
		expect(panelSrc).toContain("message.type === 'saveTitle'");
	});

	it('should call joplin.data.put with title property for saveTitle', () => {
		expect(panelSrc).toMatch(/joplin\.data\.put\(\['notes',\s*\w+\],\s*null,\s*\{\s*title/);
	});
});

describe('title field — block-editor.js', () => {
	const editorSrc = fs.readFileSync(path.join(ROOT, 'src', 'webview', 'block-editor.js'), 'utf-8');

	it('should set the title input value in loadNote', () => {
		expect(editorSrc).toContain('note-title');
		expect(editorSrc).toMatch(/note\.title/);
	});

	it('should post a saveTitle message on title change', () => {
		expect(editorSrc).toContain("type: 'saveTitle'");
	});

	it('should debounce title saves', () => {
		expect(editorSrc).toMatch(/titleSaveTimer|titleTimer|TITLE_SAVE_DEBOUNCE/i);
	});
});

describe('title field — panel.css', () => {
	const css = fs.readFileSync(path.join(ROOT, 'src', 'webview', 'panel.css'), 'utf-8');

	it('should have styles for #note-title', () => {
		expect(css).toContain('#note-title');
	});
});
