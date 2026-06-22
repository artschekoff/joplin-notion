import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const editorSrc = fs.readFileSync(path.join(ROOT, 'src', 'webview', 'block-editor.js'), 'utf-8');
const cssSrc = fs.readFileSync(path.join(ROOT, 'src', 'webview', 'panel.css'), 'utf-8');

describe('vim search', () => {
	it('defines vimSearchMode state variable', () => {
		expect(editorSrc).toContain('vimSearchMode');
	});

	it('defines vimSearchQuery state variable', () => {
		expect(editorSrc).toContain('vimSearchQuery');
	});

	it('defines vimMatches array', () => {
		expect(editorSrc).toContain('vimMatches');
	});

	it('defines vimMatchCursor index', () => {
		expect(editorSrc).toContain('vimMatchCursor');
	});

	it('defines findVimMatches function', () => {
		expect(editorSrc).toContain('findVimMatches');
	});

	it('/ key enters search mode from NORMAL and BLOCK', () => {
		expect(editorSrc).toContain("e.key === '/'");
		expect(editorSrc).toContain('enterVimSearch');
	});

	it('Escape cancels search via clearVimSearch', () => {
		expect(editorSrc).toContain('clearVimSearch');
	});

	it('Enter confirms search via confirmVimSearch', () => {
		expect(editorSrc).toContain('confirmVimSearch');
	});

	it('n navigates to next match', () => {
		expect(editorSrc).toContain("e.key === 'n'");
		expect(editorSrc).toContain('vimMatchCursor');
	});

	it('N navigates to previous match', () => {
		expect(editorSrc).toContain("e.key === 'N'");
	});

	it('CSS defines search mode statusbar style', () => {
		expect(cssSrc).toContain("data-mode='search'");
	});

	it('CSS defines vim search match highlight', () => {
		expect(cssSrc).toContain('ce-block--vim-search-match');
	});
});
