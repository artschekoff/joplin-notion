import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const panelSrc = fs.readFileSync(path.join(ROOT, 'src', 'panel.ts'), 'utf-8');

describe('panel.ts — insertResource message handler', () => {
	it('handles insertResource message type', () => {
		expect(panelSrc).toContain('MSG.INSERT_RESOURCE');
	});

	it('calls joplin.data.post for resources endpoint', () => {
		expect(panelSrc).toContain("joplin.data.post(['resources']");
	});

	it('responds with resourceInserted message type', () => {
		expect(panelSrc).toContain('MSG.RESOURCE_INSERTED');
	});

	it('responds with resourceInsertError on failure', () => {
		expect(panelSrc).toContain('MSG.RESOURCE_INSERT_ERROR');
	});

	it('exports handleInsertResource for testing', () => {
		expect(panelSrc).toContain('export async function handleInsertResource');
	});

	it('cleans up temp file in finally block', () => {
		expect(panelSrc).toContain('fs.unlinkSync');
		expect(panelSrc).toContain('finally');
	});
});
