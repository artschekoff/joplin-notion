import joplin from 'api';
import { shareNoteAsText, exportNoteWithPandoc, copyFileToDirectory } from './utils/share-note';

const getCurrentNote = async (): Promise<{ id: string; title: string; body: string } | null> => {
	const note = await joplin.workspace.selectedNote();
	if (!note) return null;
	const full = await joplin.data.get(['notes', note.id], { fields: ['id', 'title', 'body'] });
	return full ?? null;
};

/**
 * Prompts the user to pick a destination folder, then copies the exported file there.
 * Does nothing if the user cancels the dialog.
 */
const saveExportedFile = async (tempPath: string): Promise<void> => {
	const paths: string[] = await joplin.views.dialogs.showOpenDialog({
		properties: ['openDirectory', 'createDirectory'],
	});
	if (!paths || !paths.length) return;
	await copyFileToDirectory(tempPath, paths[0]);
};

/**
 * Exports or shares the currently selected note.
 *
 * - 'text' → converts markdown to plain text and opens a mailto: URL.
 * - 'pdf'  → triggers Joplin's built-in PDF export dialog.
 * - 'doc'  → converts markdown to DOCX via pandoc, then saves to a user-chosen folder.
 * - 'rtf'  → converts markdown to RTF via pandoc, then saves to a user-chosen folder.
 */
export const shareCurrentNote = async (format: string): Promise<void> => {
	const note = await getCurrentNote();
	if (!note) throw new Error('No note selected. Please open a note first.');
	if (format === 'text') {
		await shareNoteAsText({ title: note.title, body: note.body });
	} else if (format === 'pdf') {
		await joplin.commands.execute('exportPdf', [note.id]);
	} else if (format === 'doc') {
		const outputPath = await exportNoteWithPandoc({
			title: note.title,
			body: note.body,
			format: 'docx',
		});
		await saveExportedFile(outputPath);
	} else if (format === 'rtf') {
		const outputPath = await exportNoteWithPandoc({
			title: note.title,
			body: note.body,
			format: 'rtf',
		});
		await saveExportedFile(outputPath);
	}
};
