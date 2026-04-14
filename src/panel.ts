import joplin from 'api';

const PANEL_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <link rel="stylesheet" href="./webview/panel.css" />
</head>
<body>
  <div id="app">
    <div id="editor-pane">
      <div id="editor-container"></div>
    </div>
    <div id="resizer"></div>
    <div id="chat-pane">
      <div id="messages"></div>
      <div id="input-area">
        <textarea id="prompt-input" placeholder="Ask AI..."></textarea>
        <button id="send-btn">Send</button>
      </div>
    </div>
  </div>
  <script src="./webview/block-editor.js"></script>
  <script src="./webview/panel.js"></script>
</body>
</html>
`;

export const initPanel = async (): Promise<void> => {
	const panel = await joplin.views.panels.create('notionEditorPanel');
	await joplin.views.panels.setHtml(panel, PANEL_HTML);
	await joplin.views.panels.addScript(panel, './webview/panel.css');
	await joplin.views.panels.addScript(panel, './webview/block-editor.js');
	await joplin.views.panels.addScript(panel, './webview/panel.js');

	await joplin.views.panels.onMessage(panel, async (message: { type: string; payload?: unknown }) => {
		if (message.type === 'saveBlocks') {
			// TODO: Phase 1 — convert blocks to Markdown and save via joplin.data.put
		}
		if (message.type === 'getNote') {
			const note = await joplin.workspace.selectedNote();
			return note ?? null;
		}
	});

	await joplin.workspace.onNoteSelectionChange(async () => {
		const note = await joplin.workspace.selectedNote();
		if (note) {
			await joplin.views.panels.postMessage(panel, { type: 'loadNote', note });
		}
	});
};
