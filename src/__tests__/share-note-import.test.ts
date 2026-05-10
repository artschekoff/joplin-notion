import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { importNoteWithPandoc } from '../utils/share-note';

// Only runs if pandoc is installed on the system.
const hasPandoc = (() => {
  try { require('child_process').execFileSync('pandoc', ['--version']); return true; }
  catch { return false; }
})();

(hasPandoc ? describe : describe.skip)('importNoteWithPandoc', () => {
  it('converts a simple markdown file via pandoc (round-trip)', async () => {
    // Write a .md file to tmp, convert it — confirms pandoc round-trip works.
    const tmpMd = path.join(os.tmpdir(), 'test-import-roundtrip.md');
    await fs.promises.writeFile(tmpMd, '# Hello\n\nWorld paragraph.', 'utf-8');
    const buf = await fs.promises.readFile(tmpMd);
    const result = await importNoteWithPandoc({ content: buf, format: 'md', filename: 'test-import-roundtrip.md' });
    expect(result).toContain('Hello');
    expect(result).toContain('World paragraph');
    await fs.promises.unlink(tmpMd);
  });
});
