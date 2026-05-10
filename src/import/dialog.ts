import joplin from 'api';
import { convertToMarkdown } from './converter';

const DIALOG_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: system-ui, sans-serif;
      padding: 16px 20px;
      min-width: 400px;
      box-sizing: border-box;
    }
    h2 { margin: 0 0 14px; font-size: 15px; font-weight: 600; }
    label { display: block; margin-bottom: 6px; font-size: 13px; color: #555; }
    input[type="file"] { margin-bottom: 6px; font-size: 13px; }
    #file-name-display { font-size: 12px; color: #888; min-height: 15px; }
    #status { margin-top: 10px; font-size: 12px; color: #4a90d9; min-height: 15px; }
    .limits {
      font-size: 11px; color: #aaa; margin-top: 14px;
      border-top: 1px solid #eee; padding-top: 10px;
    }
  </style>
</head>
<body>
  <h2>Import Note from Document</h2>
  <label>Select a file:</label>
  <input type="file" id="file-input"
    accept=".docx,.rtf,.pdf,.md,.markdown,.txt" />
  <div id="file-name-display"></div>
  <div id="status"></div>
  <p class="limits">
    DOCX · RTF → Markdown via Pandoc (formatting preserved)<br>
    PDF → plain text extraction<br>
    Markdown · TXT → imported as-is
  </p>
  <form name="importForm">
    <input type="hidden" id="hdn-content"  name="content"  value="">
    <input type="hidden" id="hdn-filename" name="filename" value="">
    <input type="hidden" id="hdn-ext"      name="ext"      value="">
  </form>
</body>
</html>`;

let dialogHandle: string | null = null;

async function ensureDialog(): Promise<string> {
	if (dialogHandle) return dialogHandle;
	dialogHandle = await joplin.views.dialogs.create('importNoteFromDocumentDialog');
	await joplin.views.dialogs.setHtml(dialogHandle, DIALOG_HTML);
	await joplin.views.dialogs.addScript(dialogHandle, './webview/import-dialog.js');
	await joplin.views.dialogs.setButtons(dialogHandle, [
		{ id: 'ok', title: 'Import' },
		{ id: 'cancel', title: 'Cancel' },
	]);
	return dialogHandle;
}

export async function showImportDialog(): Promise<void> {
	const handle = await ensureDialog();
	const result = await joplin.views.dialogs.open(handle);

	if (result.id !== 'ok') return;

	const form = result.formData?.importForm as Record<string, string> | undefined;
	const content = form?.content ?? '';
	const filename = form?.filename ?? 'Imported Note';
	const ext = form?.ext ?? '';

	if (!content || !ext) {
		await joplin.views.dialogs.showMessageBox('Please select a file before clicking Import.');
		return;
	}

	const buf = Buffer.from(content, 'base64');

	let converted;
	try {
		converted = await convertToMarkdown(buf, ext, filename);
	} catch (err) {
		await joplin.views.dialogs.showMessageBox(`Conversion failed: ${(err as Error).message}`);
		return;
	}

	const title = converted.title.trim() || filename.replace(/\.[^.]+$/, '') || 'Imported Note';

	let parentId: string | undefined;
	try {
		const note = await joplin.workspace.selectedNote();
		parentId = note?.parent_id as string | undefined;
	} catch (_) {}

	await joplin.data.post(['notes'], null, {
		title,
		body: converted.markdown,
		...(parentId ? { parent_id: parentId } : {}),
	});
}
