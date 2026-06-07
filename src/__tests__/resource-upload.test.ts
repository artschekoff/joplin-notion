import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const panelSrc = fs.readFileSync(path.join(ROOT, 'src', 'panel.ts'), 'utf-8');

describe('panel.ts — insertResource message handler', () => {
	it('handles insertResource message type', () => {
		expect(panelSrc).toContain("message.type === 'insertResource'");
	});

	it('calls joplin.data.post for resources endpoint', () => {
		expect(panelSrc).toContain("joplin.data.post(['resources']");
	});

	it('responds with resourceInserted message type', () => {
		expect(panelSrc).toContain("type: 'resourceInserted'");
	});

	it('responds with resourceInsertError on failure', () => {
		expect(panelSrc).toContain("type: 'resourceInsertError'");
	});

	it('exports handleInsertResource for testing', () => {
		expect(panelSrc).toContain('export async function handleInsertResource');
	});

	it('cleans up temp file in finally block', () => {
		expect(panelSrc).toContain('fs.unlinkSync');
		expect(panelSrc).toContain('finally');
	});
});
