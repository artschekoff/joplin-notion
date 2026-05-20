import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { importNoteWithPandoc } from '../utils/share-note';

// Only runs if pandoc is installed on the system.
const hasPandoc = (() => {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		require('child_process').execFileSync('pandoc', ['--version']);
		return true;
	} catch {
		return false;
	}
})();

(hasPandoc ? describe : describe.skip)('importNoteWithPandoc', () => {
	it('converts a simple markdown file via pandoc (round-trip)', async () => {
		// Write a .md file to tmp, convert it — confirms pandoc round-trip works.
		const tmpMd = path.join(os.tmpdir(), 'test-import-roundtrip.md');
		await fs.promises.writeFile(tmpMd, '# Hello\n\nWorld paragraph.', 'utf-8');
		const buf = await fs.promises.readFile(tmpMd);
		const result = await importNoteWithPandoc({
			content: buf,
			format: 'md',
			filename: 'test-import-roundtrip.md',
		});
		expect(result).toContain('Hello');
		expect(result).toContain('World paragraph');
		await fs.promises.unlink(tmpMd);
	});

	it('converts RTF tables to GFM pipe tables (not pandoc simple_tables)', async () => {
		// RTF with a 3-column table: Name / Age / City rows
		const rtf = [
			'{\\rtf1\\ansi\\deff0',
			'{\\fonttbl{\\f0 Times New Roman;}}',
			'\\f0\\fs24',
			'\\trowd\\cellx2000\\cellx4000\\cellx6000',
			'\\pard\\intbl Name\\cell Age\\cell City\\cell\\row',
			'\\trowd\\cellx2000\\cellx4000\\cellx6000',
			'\\pard\\intbl Alice\\cell 30\\cell London\\cell\\row',
			'}',
		].join('\n');

		const result = await importNoteWithPandoc({
			content: Buffer.from(rtf),
			format: 'rtf',
			filename: 'table-test.rtf',
		});

		// Must contain pipe characters — GFM pipe table, not simple_tables dashes
		expect(result).toContain('|');
		// Must NOT use the simple_tables "------- ---" separator style without pipes
		expect(result).not.toMatch(/^[ \t]*-{3,}[ \t]+-{3,}/m);
	});
});
