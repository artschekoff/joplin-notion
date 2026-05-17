import joplin from 'api';

let panelHandle: string | null = null;
let panelVisible = false;
let lastProcessedErrorTs = 0;
let isSavingFromPanel = false;
let lastSavedBody: string | null = null;

const PANEL_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
	<div id="app">
		<input id="note-title" type="text" placeholder="Untitled" spellcheck="true" />
		<div id="editor-wrapper">
			<div id="editor-container" tabindex="-1"></div>
			<div id="toc-panel" class="toc-hidden">
				<div id="toc-header">
					<span>Outline</span>
				</div>
				<div id="toc-list"></div>
			</div>
		</div>
		<div id="vim-statusbar" data-mode="insert">
			<span id="vim-mode-label">INSERT</span>
		</div>
	</div>
	<button id="toc-toggle-btn" title="Toggle outline" aria-label="Toggle outline">
		<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<line x1="3" y1="6" x2="21" y2="6"/>
			<line x1="3" y1="12" x2="15" y2="12"/>
			<line x1="3" y1="18" x2="18" y2="18"/>
		</svg>
	</button>
</body>
</html>`;

const getCurrentNote = async (): Promise<{ id: string; title: string; body: string } | null> => {
	const note = await joplin.workspace.selectedNote();
	if (!note) return null;
	const full = await joplin.data.get(['notes', note.id], { fields: ['id', 'title', 'body'] });
	return full ?? null;
};

const sendNoteLoaded = async () => {
	if (!panelHandle) return;
	const note = await getCurrentNote();
	if (!note) return;
	await joplin.views.panels.postMessage(panelHandle, {
		type: 'noteLoaded',
		note: { id: note.id, title: note.title, body: note.body },
	});
};

export const initPanel = async (): Promise<void> => {
	panelVisible = false;

	panelHandle = await joplin.views.panels.create('notionBlockEditorPanel');
	await joplin.views.panels.setHtml(panelHandle, PANEL_HTML);
	await joplin.views.panels.addScript(panelHandle, './webview/panel.css');
	await joplin.views.panels.addScript(panelHandle, './webview/vendor/editorjs.umd.js');
	await joplin.views.panels.addScript(panelHandle, './webview/vendor/header.umd.js');
	await joplin.views.panels.addScript(panelHandle, './webview/vendor/editorjs-list.umd.js');
	await joplin.views.panels.addScript(panelHandle, './webview/vendor/checklist.umd.js');
	await joplin.views.panels.addScript(panelHandle, './webview/vendor/code.umd.js');
	await joplin.views.panels.addScript(panelHandle, './webview/vendor/quote.umd.js');
	await joplin.views.panels.addScript(panelHandle, './webview/vendor/delimiter.umd.js');
	await joplin.views.panels.addScript(panelHandle, './webview/vendor/editorjs-drag-drop.js');
	await joplin.views.panels.addScript(panelHandle, './webview/markdown-converter.js');
	await joplin.views.panels.addScript(panelHandle, './webview/block-editor.js');
	await joplin.views.panels.hide(panelHandle);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	await joplin.views.panels.onMessage(panelHandle, async (message: any) => {
		if (!panelHandle) return;

		if (message.type === 'getNote') {
			await sendNoteLoaded();
			return;
		}

		if (message.type === 'saveBlocks') {
			const { noteId, markdown } = message as { noteId: unknown; markdown: unknown };
			if (typeof noteId === 'string' && noteId && typeof markdown === 'string') {
				isSavingFromPanel = true;
				lastSavedBody = markdown;
				try {
					await joplin.data.put(['notes', noteId], null, { body: markdown });
				} catch (saveErr) {
					const errMsg = saveErr instanceof Error ? saveErr.message : String(saveErr);
					console.error('saveBlocks failed:', errMsg);
					if (panelHandle) {
						await joplin.views.panels.postMessage(panelHandle, {
							type: 'error',
							message: 'Failed to save note. Please try again.',
						});
					}
				} finally {
					setTimeout(() => {
						isSavingFromPanel = false;
						lastSavedBody = null;
					}, 500);
				}
			}
			return;
		}

		if (message.type === 'saveTitle') {
			const { noteId, title } = message as { noteId: unknown; title: unknown };
			if (typeof noteId === 'string' && noteId && typeof title === 'string') {
				try {
					await joplin.data.put(['notes', noteId], null, { title });
				} catch (saveErr) {
					const errMsg = saveErr instanceof Error ? saveErr.message : String(saveErr);
					console.error('saveTitle failed:', errMsg);
				}
			}
			return;
		}

		if (message.type === 'askAI') {
			const text = typeof message.text === 'string' ? message.text : '';
			const prompt = typeof message.prompt === 'string' ? message.prompt : '';
			const isSelection = message.isSelection === true;
			try {
				await joplin.settings.setValue(
					'notion.askAI.request',
					JSON.stringify({ text, prompt, isSelection, ts: Date.now() }),
				);
			} catch (err) {
				console.error('askAI bridge write failed:', err);
			}
			return;
		}
	});

	await joplin.workspace.onNoteSelectionChange(async () => {
		if (panelHandle && panelVisible) {
			await sendNoteLoaded();
		}
	});

	await joplin.workspace.onNoteChange(async () => {
		if (!panelHandle || !panelVisible) return;
		if (isSavingFromPanel) {
			const note = await getCurrentNote();
			const norm = (s: string) => s.replace(/\r\n/g, '\n').trimEnd();
			if (note && lastSavedBody !== null && norm(note.body) === norm(lastSavedBody)) return;
		}
		await sendNoteLoaded();
	});

	await joplin.settings.onChange(async () => {
		try {
			if (!panelHandle || !panelVisible) return;
			const raw = await joplin.settings.globalValue('notion.askAI.error');
			if (!raw) return;
			const parsed = JSON.parse(raw as string) as { message?: string; ts?: number };
			if (!parsed.message || !parsed.ts) return;
			if (parsed.ts <= lastProcessedErrorTs) return;
			lastProcessedErrorTs = parsed.ts;
			await joplin.views.panels.postMessage(panelHandle, {
				type: 'askAIError',
				message: parsed.message,
			});
		} catch {
			// ignore
		}
	});
};

export const toggleBlockEditorPane = async (): Promise<void> => {
	if (!panelHandle) return;
	panelVisible = !panelVisible;
	if (panelVisible) {
		await joplin.views.panels.show(panelHandle);
		await sendNoteLoaded();
	} else {
		await joplin.views.panels.hide(panelHandle);
	}
	try {
		await joplin.settings.setValue('notion.blockEditor.active', panelVisible);
	} catch (err) {
		console.error('blockEditor.active write failed:', err);
	}
};

export const getBlockEditorEnabled = (): boolean => panelVisible;
