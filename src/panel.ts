import joplin from 'api';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const MSG = {
	GET_NOTE: 'getNote',
	SAVE_BLOCKS: 'saveBlocks',
	SAVE_TITLE: 'saveTitle',
	ASK_AI: 'askAI',
	INSERT_RESOURCE: 'insertResource',
	NOTE_LOADED: 'noteLoaded',
	ERROR: 'error',
	RESOURCE_INSERTED: 'resourceInserted',
	RESOURCE_INSERT_ERROR: 'resourceInsertError',
	ASK_AI_ERROR: 'askAIError',
	TOGGLE_MAIN_EDITOR: 'toggleMainEditor',
	MAIN_EDITOR_STATE_CHANGED: 'mainEditorStateChanged',
} as const;

let panelHandle: string | null = null;
let panelVisible = false;
let lastProcessedErrorTs = Date.now();
let mainEditorHidden = false;
let savedPanes: string[] | null = null;

// Joplin stores plugin settings under plugin-${pluginId}.${key} internally.
// globalValue() reads keys as-is (no prefix), so we must pass the full key.
const AI_ASSISTANT_ERROR_KEY = 'plugin-net.roxl.joplin-ai.notion.askAI.error';
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
	<button id="settings-btn" title="Editor settings" aria-label="Editor settings">
		<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<circle cx="12" cy="12" r="3"/>
			<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
		</svg>
	</button>
	<button id="toc-toggle-btn" title="Toggle outline" aria-label="Toggle outline">
		<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<line x1="3" y1="6" x2="21" y2="6"/>
			<line x1="3" y1="12" x2="15" y2="12"/>
			<line x1="3" y1="18" x2="18" y2="18"/>
		</svg>
	</button>
	<button id="hide-editor-btn" title="Toggle main editor" aria-label="Toggle main editor">
		<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<rect x="3" y="3" width="7" height="18" rx="1"/>
			<rect x="14" y="3" width="7" height="18" rx="1"/>
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
		type: MSG.NOTE_LOADED,
		note: { id: note.id, title: note.title, body: note.body },
	});
};

export async function handleInsertResource(
	dataBase64: string,
	filename: string,
	mimeType: string,
): Promise<{ resourceId: string; title: string; mimeType: string }> {
	const buffer = Buffer.from(dataBase64, 'base64');
	const safeName = path.basename(filename);
	const tmpPath = path.join(os.tmpdir(), `joplin-plugin-res-${Date.now()}-${safeName}`);
	try {
		fs.writeFileSync(tmpPath, buffer);
		const result = await joplin.data.post(['resources'], null, { title: safeName }, [
			{ path: tmpPath },
		]);
		return {
			resourceId: result.id as string,
			title: (result.title as string) || safeName,
			mimeType: (result.mime as string) || mimeType,
		};
	} finally {
		try {
			fs.unlinkSync(tmpPath);
		} catch (_) {}
	}
}

const PANE_CYCLE = [['editor', 'viewer'], ['editor'], ['viewer']] as const;

const callsToReach = (from: string[], to: string[]): number => {
	const fromKey = from.join(',');
	const toKey = to.join(',');
	for (let steps = 0; steps < PANE_CYCLE.length; steps++) {
		const idx = PANE_CYCLE.findIndex((p) => p.join(',') === fromKey);
		if (idx === -1) break;
		const target = PANE_CYCLE[(idx + steps) % PANE_CYCLE.length];
		if (target.join(',') === toKey) return steps;
	}
	return 0;
};

const restoreMainEditor = async (): Promise<void> => {
	if (!mainEditorHidden || !savedPanes) return;
	const steps = callsToReach(['viewer'], savedPanes);
	for (let i = 0; i < steps; i++) {
		await joplin.commands.execute('toggleVisiblePanes');
	}
	mainEditorHidden = false;
	savedPanes = null;
	if (panelHandle) {
		await joplin.views.panels.postMessage(panelHandle, {
			type: MSG.MAIN_EDITOR_STATE_CHANGED,
			hidden: false,
		});
	}
};

const toggleMainEditor = async (): Promise<void> => {
	if (mainEditorHidden) {
		await restoreMainEditor();
		return;
	}
	const values = await joplin.settings.globalValues(['noteVisiblePanes']);
	const current = Array.isArray(values[0]) ? (values[0] as string[]) : ['editor', 'viewer'];
	savedPanes = [...current];
	const steps = callsToReach(current, ['viewer']);
	for (let i = 0; i < steps; i++) {
		await joplin.commands.execute('toggleVisiblePanes');
	}
	mainEditorHidden = true;
	if (panelHandle) {
		await joplin.views.panels.postMessage(panelHandle, {
			type: MSG.MAIN_EDITOR_STATE_CHANGED,
			hidden: true,
		});
	}
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

		if (message.type === MSG.GET_NOTE) {
			await sendNoteLoaded();
			return;
		}

		if (message.type === MSG.SAVE_BLOCKS) {
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
							type: MSG.ERROR,
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

		if (message.type === MSG.SAVE_TITLE) {
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

		if (message.type === MSG.ASK_AI) {
			const text = typeof message.text === 'string' ? message.text : '';
			const prompt = typeof message.prompt === 'string' ? message.prompt : '';
			const isSelection = message.isSelection === true;
			console.log(
				'[notion-panel] askAI received — text.len:',
				text.length,
				'prompt:',
				prompt.substring(0, 50),
			);
			try {
				await joplin.settings.setValue(
					'notion.askAI.request',
					JSON.stringify({ text, prompt, isSelection, ts: Date.now() }),
				);
				console.log('[notion-panel] notion.askAI.request written OK');
			} catch (err) {
				console.error('askAI bridge write failed:', err);
			}
			return;
		}

		if (message.type === MSG.TOGGLE_MAIN_EDITOR) {
			await toggleMainEditor();
			return;
		}

		if (message.type === MSG.INSERT_RESOURCE) {
			const { uploadId, dataBase64, filename, mimeType } = message as {
				uploadId: number;
				dataBase64: string;
				filename: string;
				mimeType: string;
			};
			try {
				const result = await handleInsertResource(dataBase64, filename, mimeType);
				if (panelHandle) {
					await joplin.views.panels.postMessage(panelHandle, {
						type: MSG.RESOURCE_INSERTED,
						uploadId,
						resourceId: result.resourceId,
						title: result.title,
						mimeType: result.mimeType,
					});
				}
			} catch (err) {
				if (panelHandle) {
					await joplin.views.panels.postMessage(panelHandle, {
						type: MSG.RESOURCE_INSERT_ERROR,
						uploadId,
						message: err instanceof Error ? err.message : String(err),
					});
				}
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

	// settings.onChange only fires for this plugin's own settings, so we poll
	// globalValue to detect errors written by joplin-ai.
	setInterval(async () => {
		try {
			if (!panelHandle || !panelVisible) return;
			const raw = await joplin.settings.globalValue(AI_ASSISTANT_ERROR_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw as string) as { message?: string; ts?: number };
			if (!parsed.message || !parsed.ts) return;
			if (parsed.ts <= lastProcessedErrorTs) return;
			lastProcessedErrorTs = parsed.ts;
			await joplin.views.panels.postMessage(panelHandle, {
				type: MSG.ASK_AI_ERROR,
				message: parsed.message,
			});
		} catch {
			// ignore
		}
	}, 300);
};

export const toggleBlockEditorPane = async (): Promise<void> => {
	if (!panelHandle) return;
	panelVisible = !panelVisible;
	if (panelVisible) {
		await joplin.views.panels.show(panelHandle);
		await sendNoteLoaded();
	} else {
		if (mainEditorHidden) await restoreMainEditor();
		await joplin.views.panels.hide(panelHandle);
	}
	try {
		await joplin.settings.setValue('notion.blockEditor.active', panelVisible);
	} catch (err) {
		console.error('blockEditor.active write failed:', err);
	}
};

export const getBlockEditorEnabled = (): boolean => panelVisible;
