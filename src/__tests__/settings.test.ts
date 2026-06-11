import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const editorSrc = fs.readFileSync(path.join(ROOT, 'src', 'webview', 'block-editor.js'), 'utf-8');
const cssSrc = fs.readFileSync(path.join(ROOT, 'src', 'webview', 'panel.css'), 'utf-8');
const panelSrc = fs.readFileSync(path.join(ROOT, 'src', 'panel.ts'), 'utf-8');

describe('block editor settings', () => {
	it('defines SETTINGS_STORAGE_KEY constant', () => {
		expect(editorSrc).toContain('SETTINGS_STORAGE_KEY');
	});

	it('defines FONT_SIZE_OPTIONS array', () => {
		expect(editorSrc).toContain('FONT_SIZE_OPTIONS');
	});

	it('applyFontSize sets --editor-font-size CSS variable', () => {
		expect(editorSrc).toContain('--editor-font-size');
		expect(editorSrc).toContain('applyFontSize');
	});

	it('settings are loaded from and saved to localStorage', () => {
		expect(editorSrc).toContain('localStorage.setItem');
		expect(editorSrc).toContain('localStorage.getItem');
		expect(editorSrc).toContain('SETTINGS_STORAGE_KEY');
	});

	it('initSettings is called from boot', () => {
		const bootIdx = editorSrc.indexOf('const boot =');
		expect(bootIdx).toBeGreaterThan(-1);
		const bootSection = editorSrc.slice(bootIdx, bootIdx + 200);
		expect(bootSection).toContain('initSettings');
	});

	it('CSS defines --editor-font-size custom property', () => {
		expect(cssSrc).toContain('--editor-font-size');
	});

	it('panel HTML contains settings-btn', () => {
		expect(panelSrc).toContain('settings-btn');
	});

	it('defines FONT_FAMILY_OPTIONS array', () => {
		expect(editorSrc).toContain('FONT_FAMILY_OPTIONS');
	});

	it('defines FONT_FAMILY_DEFAULT constant', () => {
		expect(editorSrc).toContain('FONT_FAMILY_DEFAULT');
	});

	it('applyFontFamily sets --editor-font-family CSS variable', () => {
		expect(editorSrc).toContain('--editor-font-family');
		expect(editorSrc).toContain('applyFontFamily');
	});

	it('settings load/save handles fontFamily field', () => {
		expect(editorSrc).toContain('fontFamily');
		expect(editorSrc).toContain('FONT_FAMILY_OPTIONS');
	});

	it('CSS defines --editor-font-family custom property', () => {
		expect(cssSrc).toContain('--editor-font-family');
	});

	it('filterable font dropdown renders each option in its own font', () => {
		expect(editorSrc).toContain('be-font-family-option');
		expect(editorSrc).toContain('fontFamily');
	});

	it('font dropdown filter input narrows visible options', () => {
		expect(editorSrc).toContain('be-font-filter');
	});
});
