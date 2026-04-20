import * as path from 'path';
import * as fs from 'fs';

const ROOT = path.resolve(__dirname, '..', '..');

const readJson = (relativePath: string): Record<string, unknown> => {
	const raw = fs.readFileSync(path.join(ROOT, relativePath), 'utf-8');
	return JSON.parse(raw) as Record<string, unknown>;
};

describe('project namespace', () => {
	const EXPECTED_PLUGIN_ID = 'net.roxl.joplin-notion';

	describe('src/manifest.json', () => {
		const manifest = readJson('src/manifest.json');

		it('should have the correct plugin id', () => {
			expect(manifest.id).toBe(EXPECTED_PLUGIN_ID);
		});
	});

	describe('package.json', () => {
		const pkg = readJson('package.json');

		it('should have a matching package name', () => {
			expect(pkg.name).toBe(EXPECTED_PLUGIN_ID);
		});
	});
});
