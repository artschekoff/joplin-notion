import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const panelSrc = fs.readFileSync(path.join(ROOT, 'src', 'panel.ts'), 'utf-8');

describe('note content sync — panel.ts', () => {
	it('should register an onNoteChange listener to detect external edits', () => {
		expect(panelSrc).toContain('onNoteChange');
	});

	it('should call sendNoteLoaded inside the onNoteChange handler', () => {
		const noteChangeIdx = panelSrc.indexOf('onNoteChange');
		expect(noteChangeIdx).toBeGreaterThan(-1);
		const afterNoteChange = panelSrc.slice(noteChangeIdx);
		expect(afterNoteChange).toMatch(/sendNoteLoaded/);
	});

	it('should guard against reload loop when panel itself triggered the save', () => {
		expect(panelSrc).toMatch(/isSavingFromPanel/);
	});

	it('should set the save guard to true before saving blocks', () => {
		const saveBlocksIdx = panelSrc.indexOf('MSG.SAVE_BLOCKS');
		expect(saveBlocksIdx).toBeGreaterThan(-1);
		const saveBlocksSection = panelSrc.slice(saveBlocksIdx, saveBlocksIdx + 600);
		expect(saveBlocksSection).toMatch(/isSavingFromPanel\s*=\s*true/);
	});

	it('should skip reload in onNoteChange when save guard is active', () => {
		const noteChangeIdx = panelSrc.indexOf('onNoteChange');
		expect(noteChangeIdx).toBeGreaterThan(-1);
		const afterNoteChange = panelSrc.slice(noteChangeIdx, noteChangeIdx + 400);
		expect(afterNoteChange).toMatch(/isSavingFromPanel/);
	});
});
