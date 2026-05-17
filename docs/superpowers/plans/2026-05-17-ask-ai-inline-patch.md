# Ask AI Inline Patch Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When user selects text/block and clicks "Ask AI" in the block editor, show an inline floating prompt input; on submit, joplin-ai patches only the selected fragment in edit mode — without showing the AI chat panel.

**Architecture:** joplin-notion's `block-editor.js` shows an inline popup, posts `{ type: 'askAI', text, prompt, isSelection: true }` to `panel.ts`, which writes `notion.askAI.request` (global setting). joplin-ai's `index.ts` listens via `settings.onChange`, reads the payload, and calls a new `executeWithSelection(text, prompt)` in `panel.ts` that silently runs `handleExecute` in edit mode — using the existing `isSelection`/`selectionText` infrastructure. Errors are written back via a new `notion.askAI.error` setting (registered in joplin-ai) and surfaced as a toast in the block editor.

**Tech Stack:** TypeScript, Jest (joplin-ai tests), vanilla JS (block-editor.js), Joplin plugin API

---

## File Map

| File | Repo | Change |
|---|---|---|
| `src/settings.ts` | joplin-ai | Add `notionBlockEditorError` key + registration |
| `src/panel.ts` | joplin-ai | Add optional `onError` param to `handleExecute`; add `executeWithSelection` export |
| `src/__tests__/panel.test.ts` | joplin-ai | Tests for `executeWithSelection` |
| `src/index.ts` | joplin-ai | `settings.onChange` listener → `executeWithSelection` |
| `src/__tests__/index.test.ts` | joplin-ai | Tests for the listener |
| `src/panel.ts` | joplin-notion | Extend `askAI` message payload; add `settings.onChange` error listener |
| `src/webview/block-editor.js` | joplin-notion | Inline popup UI; in-flight state; error toast |

---

## Task 1: joplin-ai — add `notion.askAI.error` setting

**Files:**
- Modify: `src/settings.ts` (joplin-ai)

- [ ] **Step 1: Add key to SETTING_KEYS and register the setting**

Open `src/settings.ts`. In the `SETTING_KEYS` object, add one line after `appliedRoleId`:

```typescript
notionBlockEditorError: 'notion.askAI.error',
```

The object now ends:
```typescript
export const SETTING_KEYS = {
	provider: 'aiProvider',
	openaiKey: 'openaiApiKey',
	openaiModel: 'openaiModel',
	claudeKey: 'claudeApiKey',
	claudeModel: 'claudeModel',
	claudeCodeKey: 'claudeCodeApiKey',
	claudeCodeModel: 'claudeCodeModel',
	perplexityKey: 'perplexityApiKey',
	perplexityModel: 'perplexityModel',
	agentRoles: 'agentRoles',
	appliedRoleId: 'appliedRoleId',
	webSearchEnabled: 'webSearchEnabled',
	webSearchModel: 'webSearchModel',
	kieApiKey: 'kieApiKey',
	imageGenModel: 'imageGenModel',
	fileMaxSizeMb: 'fileMaxSizeMb',
	notionBlockEditorError: 'notion.askAI.error',
};
```

In `initSettings`, inside the `registerSettings` call, add after `[SETTING_KEYS.appliedRoleId]`:

```typescript
		[SETTING_KEYS.notionBlockEditorError]: {
			value: '',
			type: SettingItemType.String,
			public: true,
			label: 'Notion Block Editor: AI error',
			description:
				'JSON {message, ts} written by AI Assistant when a block-editor patch request fails.',
		},
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai
git add src/settings.ts
git commit -m "feat: register notion.askAI.error setting for block-editor error bridge"
```

---

## Task 2: joplin-ai — `executeWithSelection` in panel.ts

**Files:**
- Modify: `src/panel.ts` (joplin-ai)

- [ ] **Step 1: Add optional `onError` parameter to `handleExecute`**

Find the `handleExecute` function signature (around line 567). Change it from:

```typescript
const handleExecute = async (
	handle: ViewHandle,
	prompt: string,
	history?: ChatMessage[],
	agentRolePrompt?: string,
	workMode?: WorkMode,
	attachedFiles?: AttachedFile[],
	noteId?: string,
) => {
```

To:

```typescript
const handleExecute = async (
	handle: ViewHandle,
	prompt: string,
	history?: ChatMessage[],
	agentRolePrompt?: string,
	workMode?: WorkMode,
	attachedFiles?: AttachedFile[],
	noteId?: string,
	onError?: (message: string) => void,
) => {
```

- [ ] **Step 2: Use `onError` in the catch block of `handleExecute`**

Find the `catch` block at the end of `handleExecute` (the one that posts `type: 'error'` to the panel). Replace:

```typescript
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		// Clear snapshot on error to avoid stale diff state
		lastSentNoteId = null;
		lastSentNoteBody = null;
		joplin.views.panels.postMessage(handle, {
			type: 'error',
			message: message,
		});
	}
```

With:

```typescript
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		// Clear snapshot on error to avoid stale diff state
		lastSentNoteId = null;
		lastSentNoteBody = null;
		if (onError) {
			onError(message);
		} else {
			joplin.views.panels.postMessage(handle, {
				type: 'error',
				message: message,
			});
		}
	}
```

- [ ] **Step 3: Add `executeWithSelection` export at the end of panel.ts**

After the `triggerAskAI` export (the last function in the file), add:

```typescript
/**
 * Silently runs an AI edit against the selected text fragment.
 * Sets editorSelection to `text`, fires handleExecute in edit mode.
 * Does not open or show the chat panel.
 * On error, writes the message to notion.askAI.error for the block editor to surface.
 */
export const executeWithSelection = async (text: string, prompt: string): Promise<void> => {
	if (!chatPanelHandle || !text.trim() || !prompt.trim()) return;
	setEditorSelection(text);
	await handleExecute(
		chatPanelHandle,
		prompt,
		[],
		undefined,
		'edit',
		undefined,
		undefined,
		async (errMsg) => {
			try {
				await safeSetValue(
					SETTING_KEYS.notionBlockEditorError,
					JSON.stringify({ message: errMsg, ts: Date.now() }),
				);
			} catch {
				// ignore — error writeback failed, nothing to do
			}
		},
	);
};
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai && npx tsc --noEmit
```

Expected: no errors.

---

## Task 3: joplin-ai — tests for `executeWithSelection`

**Files:**
- Modify: `src/__tests__/panel.test.ts` (joplin-ai)

- [ ] **Step 1: Add `settings.onChange` and `settings.globalValue` to the existing `jest.mock('api', ...)` block**

In the mock, the `settings` section currently has `values`, `value`, `setValue`. Add two more mock fns at the top of the file:

```typescript
const mockSettingsOnChange = jest.fn().mockResolvedValue(undefined);
const mockSettingsGlobalValue = jest.fn().mockResolvedValue('');
```

And in the `jest.mock('api', ...)` settings section:

```typescript
settings: {
    values: (...args: any[]) => mockSettingsValues(...args),
    value: (...args: any[]) => mockSettingsValue(...args),
    setValue: (...args: any[]) => mockSettingsSetValue(...args),
    onChange: (...args: any[]) => mockSettingsOnChange(...args),
    globalValue: (...args: any[]) => mockSettingsGlobalValue(...args),
},
```

- [ ] **Step 2: Add `executeWithSelection` to the import line**

Find the existing import:
```typescript
import { initPanel, setEditorSelection, togglePanel, triggerAskAI } from '../panel';
```

Change to:
```typescript
import { initPanel, setEditorSelection, togglePanel, triggerAskAI, executeWithSelection } from '../panel';
```

- [ ] **Step 3: Write the failing tests**

Add a new `describe` block after the existing `triggerAskAI` describe block:

```typescript
describe('executeWithSelection', () => {
	beforeEach(async () => {
		jest.clearAllMocks();
		mockCreate.mockResolvedValueOnce(MOCK_CHAT_HANDLE);
		mockSettingsValues.mockResolvedValue({
			[SETTING_KEYS.provider]: 'openai',
			[SETTING_KEYS.openaiKey]: 'sk-test-key',
			[SETTING_KEYS.openaiModel]: 'gpt-4o',
		});
		mockSelectedNote.mockResolvedValue({ id: 'note-1' });
		mockDataGet.mockResolvedValue({
			id: 'note-1',
			title: 'Test Note',
			body: 'Some existing content about widgets.',
		});
		mockedSendToAI.mockResolvedValue({
			content: 'Done.',
			isEdit: true,
			editedBody: 'Some updated content about widgets.',
			actions: [],
		});
		await initPanel();
	});

	it('does nothing when text is empty', async () => {
		await executeWithSelection('', 'make it shorter');
		expect(mockedSendToAI).not.toHaveBeenCalled();
	});

	it('does nothing when prompt is empty', async () => {
		await executeWithSelection('some text', '');
		expect(mockedSendToAI).not.toHaveBeenCalled();
	});

	it('does nothing when prompt is whitespace only', async () => {
		await executeWithSelection('some text', '   ');
		expect(mockedSendToAI).not.toHaveBeenCalled();
	});

	it('sets editor selection before calling AI', async () => {
		mockPostMessage.mockClear();
		await togglePanel();
		mockPostMessage.mockClear();

		await executeWithSelection('widgets', 'make it shorter');

		const selectionCall = mockPostMessage.mock.calls.find(
			(call: unknown[]) => (call[1] as { type: string }).type === 'selectionInfo',
		);
		expect(selectionCall).toBeDefined();
		expect((selectionCall![1] as { hasSelection: boolean }).hasSelection).toBe(true);
	});

	it('calls AI in edit mode with isSelection true', async () => {
		await executeWithSelection('widgets', 'make it shorter');

		expect(mockedSendToAI).toHaveBeenCalledTimes(1);
		const context = mockedSendToAI.mock.calls[0][6];
		expect(context?.isSelection).toBe(true);
		expect(context?.selectionText).toBe('widgets');
	});

	it('does not open the chat panel', async () => {
		const showSpy = jest.spyOn((await import('api')).default.views.panels, 'show');
		showSpy.mockClear();
		await executeWithSelection('widgets', 'make it shorter');
		expect(showSpy).not.toHaveBeenCalled();
	});

	it('writes notion.askAI.error when AI throws', async () => {
		mockedSendToAI.mockRejectedValueOnce(new Error('API timeout'));

		await executeWithSelection('widgets', 'make it shorter');

		const setCalls = mockSettingsSetValue.mock.calls;
		const errorCall = setCalls.find((c: unknown[]) => c[0] === 'notion.askAI.error');
		expect(errorCall).toBeDefined();
		const payload = JSON.parse(errorCall![1] as string);
		expect(payload.message).toBe('API timeout');
		expect(typeof payload.ts).toBe('number');
	});
});
```

- [ ] **Step 4: Run tests to verify they fail (before implementation)**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai && npx jest src/__tests__/panel.test.ts --testNamePattern="executeWithSelection" --no-coverage 2>&1 | tail -20
```

Expected: tests fail because `executeWithSelection` is not yet exported (you implemented it in Task 2 — so they should pass already at this point). If panel.ts changes from Task 2 are in place, run anyway to confirm green.

- [ ] **Step 5: Run full panel test suite**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai && npx jest src/__tests__/panel.test.ts --no-coverage 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai
git add src/panel.ts src/__tests__/panel.test.ts
git commit -m "feat: add executeWithSelection for silent block-editor patch mode"
```

---

## Task 4: joplin-ai — `settings.onChange` listener in index.ts

**Files:**
- Modify: `src/index.ts` (joplin-ai)

- [ ] **Step 1: Add the listener**

Open `src/index.ts`. Add `executeWithSelection` to the import from `'./panel'`:

```typescript
import { initPanel, togglePanel, executeWithSelection } from './panel';
```

Add a module-level variable before `joplin.plugins.register`:

```typescript
let lastProcessedAskAITs = 0;
```

Inside `onStart`, after `await initPanel()`, add:

```typescript
		await joplin.settings.onChange(async () => {
			try {
				const raw = await joplin.settings.globalValue('notion.askAI.request');
				if (!raw) return;
				const parsed = JSON.parse(raw as string);
				const { text, prompt, ts } = parsed as { text?: string; prompt?: string; ts?: number };
				if (!ts || ts <= lastProcessedAskAITs) return;
				if (!text?.trim() || !prompt?.trim()) return;
				lastProcessedAskAITs = ts;
				await executeWithSelection(text, prompt);
			} catch {
				// ignore parse errors or missing setting
			}
		});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai && npx tsc --noEmit
```

Expected: no errors.

---

## Task 5: joplin-ai — tests for the settings.onChange listener

**Files:**
- Modify: `src/__tests__/index.test.ts` (joplin-ai)

- [ ] **Step 1: Add `onChange` and `globalValue` to the `jest.mock('api', ...)` block**

In `index.test.ts`, find the settings mock object and add two mocks:

```typescript
const mockSettingsOnChange = jest.fn().mockResolvedValue(undefined);
const mockSettingsGlobalValue = jest.fn().mockResolvedValue('');
```

In the `jest.mock('api', ...)`:

```typescript
settings: {
    registerSection: (...args: unknown[]) => mockSettingsRegisterSection(...args),
    registerSetting: (...args: unknown[]) => mockSettingsRegisterSetting(...args),
    registerSettings: jest.fn().mockResolvedValue(undefined),
    globalValue: (...args: unknown[]) => mockSettingsGlobalValue(...args),
    values: jest.fn().mockResolvedValue({}),
    value: jest.fn().mockResolvedValue(''),
    setValue: jest.fn().mockResolvedValue(undefined),
    onChange: (...args: unknown[]) => mockSettingsOnChange(...args),
},
```

- [ ] **Step 2: Capture the `onChange` callback**

Add a variable to capture the callback:

```typescript
let capturedOnChange: (() => Promise<void>) | null = null;
```

Update the `onChange` mock to capture the callback:

```typescript
const mockSettingsOnChange = jest.fn().mockImplementation((cb: () => Promise<void>) => {
    capturedOnChange = cb;
    return Promise.resolve();
});
```

- [ ] **Step 3: Mock `executeWithSelection` from panel**

At the top of the test file, mock the panel module:

```typescript
const mockExecuteWithSelection = jest.fn().mockResolvedValue(undefined);
jest.mock('../panel', () => ({
    initPanel: jest.fn().mockResolvedValue(undefined),
    togglePanel: jest.fn().mockResolvedValue(undefined),
    executeWithSelection: (...args: unknown[]) => mockExecuteWithSelection(...args),
}));
```

- [ ] **Step 4: Write tests**

Add a new `describe` block at the end:

```typescript
describe('notion.askAI.request settings.onChange listener', () => {
	beforeEach(async () => {
		jest.clearAllMocks();
		capturedOnChange = null;
		mockPanelsCreate.mockResolvedValue('panel-handle-test');
		await capturedOnStart!();
	});

	it('registers a settings.onChange listener during onStart', () => {
		expect(mockSettingsOnChange).toHaveBeenCalledTimes(1);
	});

	it('calls executeWithSelection when notion.askAI.request changes with valid payload', async () => {
		const payload = JSON.stringify({ text: 'selected text', prompt: 'make it shorter', isSelection: true, ts: 1000 });
		mockSettingsGlobalValue.mockResolvedValueOnce(payload);

		await capturedOnChange!();

		expect(mockExecuteWithSelection).toHaveBeenCalledWith('selected text', 'make it shorter');
	});

	it('ignores payload with duplicate ts', async () => {
		const payload = JSON.stringify({ text: 'text', prompt: 'improve', ts: 1000 });
		mockSettingsGlobalValue.mockResolvedValue(payload);

		await capturedOnChange!();
		mockExecuteWithSelection.mockClear();
		await capturedOnChange!();

		expect(mockExecuteWithSelection).not.toHaveBeenCalled();
	});

	it('ignores payload with empty text', async () => {
		const payload = JSON.stringify({ text: '', prompt: 'improve', ts: 2000 });
		mockSettingsGlobalValue.mockResolvedValueOnce(payload);

		await capturedOnChange!();

		expect(mockExecuteWithSelection).not.toHaveBeenCalled();
	});

	it('ignores payload with empty prompt', async () => {
		const payload = JSON.stringify({ text: 'hello', prompt: '', ts: 3000 });
		mockSettingsGlobalValue.mockResolvedValueOnce(payload);

		await capturedOnChange!();

		expect(mockExecuteWithSelection).not.toHaveBeenCalled();
	});

	it('ignores empty setting value', async () => {
		mockSettingsGlobalValue.mockResolvedValueOnce('');

		await capturedOnChange!();

		expect(mockExecuteWithSelection).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 5: Run all joplin-ai tests**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai && npx jest --no-coverage 2>&1 | tail -15
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/riskyworks/Documents/pc/joplin-ai
git add src/index.ts src/__tests__/index.test.ts
git commit -m "feat: wire notion.askAI.request settings listener to executeWithSelection"
```

---

## Task 6: joplin-notion — extend panel.ts (payload + error listener)

**Files:**
- Modify: `src/panel.ts` (joplin-notion)

- [ ] **Step 1: Extend the `askAI` message handler to include `prompt` and `isSelection`**

Find the `askAI` handler in `initPanel`:

```typescript
		if (message.type === 'askAI') {
			const text = typeof message.text === 'string' ? message.text : '';
			try {
				await joplin.settings.setValue(
					'notion.askAI.request',
					JSON.stringify({ text, ts: Date.now() }),
				);
			} catch (err) {
				console.error('askAI bridge write failed:', err);
			}
			return;
		}
```

Replace with:

```typescript
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
```

- [ ] **Step 2: Add a `settings.onChange` error listener inside `initPanel`**

After the existing `await joplin.workspace.onNoteChange(...)` call inside `initPanel`, add:

```typescript
	await joplin.settings.onChange(async () => {
		try {
			if (!panelHandle || !panelVisible) return;
			const raw = await joplin.settings.globalValue('notion.askAI.error');
			if (!raw) return;
			const parsed = JSON.parse(raw as string) as { message?: string; ts?: number };
			if (!parsed.message || !parsed.ts) return;
			await joplin.views.panels.postMessage(panelHandle, {
				type: 'askAIError',
				message: parsed.message,
			});
		} catch {
			// ignore
		}
	});
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/riskyworks/Documents/pc/joplin-notion && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/riskyworks/Documents/pc/joplin-notion
git add src/panel.ts
git commit -m "feat: extend askAI payload with prompt/isSelection; add error listener"
```

---

## Task 7: joplin-notion — inline popup in block-editor.js

**Files:**
- Modify: `src/webview/block-editor.js` (joplin-notion)

This task modifies three areas of the file: (1) a new popup module near the top, (2) the `AskAIInlineTool` and `AskAIBlockTune` classes, and (3) the `attachMessageHandler` onMessage handler.

- [ ] **Step 1: Add the inline popup module after the existing vim/selection helpers (around line 210)**

Find the comment `// ── Visual selection helpers ─────` (around line 210). Before the `AskAIInlineTool` class definition (around line 1193), add:

```javascript
  // ── Ask AI inline popup ──────────────────────────────────────────────────
  let askAIInflight = false;
  let askAIPopupEl = null;

  function dismissAskAIPopup() {
    if (askAIPopupEl) {
      askAIPopupEl.remove();
      askAIPopupEl = null;
    }
  }

  function clearAskAIInflight() {
    askAIInflight = false;
    dismissAskAIPopup();
  }

  function showAskAIPopup(selectedText) {
    if (askAIInflight) return;
    dismissAskAIPopup();

    const blockIndex = (editor && editor.blocks) ? editor.blocks.getCurrentBlockIndex() : -1;
    const blocks = document.querySelectorAll('#editor-container .ce-block');
    const anchorBlock = (blockIndex >= 0 && blocks[blockIndex]) ? blocks[blockIndex] : null;

    const popup = document.createElement('div');
    popup.style.cssText = [
      'position:absolute',
      'z-index:9999',
      'background:#fff',
      'border:1px solid #d1d5db',
      'border-radius:6px',
      'box-shadow:0 4px 12px rgba(0,0,0,0.15)',
      'padding:8px',
      'display:flex',
      'gap:6px',
      'align-items:center',
      'min-width:280px',
    ].join(';');

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'What should AI do with this?';
    input.style.cssText = [
      'flex:1',
      'border:1px solid #d1d5db',
      'border-radius:4px',
      'padding:4px 8px',
      'font-size:13px',
      'outline:none',
      'min-width:0',
    ].join(';');

    const runBtn = document.createElement('button');
    runBtn.textContent = 'Run';
    runBtn.disabled = true;
    runBtn.style.cssText = [
      'background:#2563eb',
      'color:#fff',
      'border:none',
      'border-radius:4px',
      'padding:4px 12px',
      'font-size:13px',
      'cursor:default',
      'opacity:0.45',
      'white-space:nowrap',
      'flex-shrink:0',
    ].join(';');

    input.addEventListener('input', function () {
      const ok = input.value.trim().length > 0;
      runBtn.disabled = !ok;
      runBtn.style.opacity = ok ? '1' : '0.45';
      runBtn.style.cursor = ok ? 'pointer' : 'default';
    });

    function submitPopup() {
      const prompt = input.value.trim();
      if (!prompt || askAIInflight) return;
      askAIInflight = true;
      runBtn.disabled = true;
      runBtn.textContent = '…';
      input.disabled = true;
      if (typeof window.webviewApi !== 'undefined') {
        window.webviewApi.postMessage({ type: 'askAI', text: selectedText, prompt: prompt, isSelection: true });
      }
    }

    runBtn.addEventListener('click', submitPopup);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { submitPopup(); return; }
      if (e.key === 'Escape') { clearAskAIInflight(); }
    });

    popup.appendChild(input);
    popup.appendChild(runBtn);
    askAIPopupEl = popup;

    // Position below the anchor block, relative to editor-container
    const container = document.getElementById('editor-container');
    if (container) {
      container.style.position = 'relative';
      if (anchorBlock) {
        const cRect = container.getBoundingClientRect();
        const bRect = anchorBlock.getBoundingClientRect();
        popup.style.top = (bRect.bottom - cRect.top + 4) + 'px';
        popup.style.left = (bRect.left - cRect.left) + 'px';
      } else {
        popup.style.top = '8px';
        popup.style.left = '8px';
      }
      container.appendChild(popup);
    } else {
      popup.style.position = 'fixed';
      popup.style.top = '80px';
      popup.style.left = '50%';
      popup.style.transform = 'translateX(-50%)';
      document.body.appendChild(popup);
    }

    function outsideClickHandler(e) {
      if (!popup.contains(e.target)) {
        clearAskAIInflight();
        document.removeEventListener('mousedown', outsideClickHandler);
      }
    }
    document.addEventListener('mousedown', outsideClickHandler);

    setTimeout(function () { input.focus(); }, 0);
  }
```

- [ ] **Step 2: Modify `AskAIInlineTool.surround()` to use the popup**

Find the existing `AskAIInlineTool` class (around line 1195). Replace the `surround` method:

```javascript
    surround(range) {
      if (!range) return;
      const text = range.toString().trim();
      if (text && typeof window.webviewApi !== 'undefined') {
        window.webviewApi.postMessage({ type: 'askAI', text });
      }
    }
```

With:

```javascript
    surround(range) {
      if (!range || askAIInflight) return;
      const text = range.toString().trim();
      if (text) showAskAIPopup(text);
    }
```

- [ ] **Step 3: Modify `AskAIBlockTune` click handler to use the popup**

Find the `AskAIBlockTune` class click listener (around line 1240). Replace the `wrapper.addEventListener('click', ...)` callback:

```javascript
      wrapper.addEventListener('click', async () => {
        const blockIndex = this._api.blocks.getCurrentBlockIndex();
        let md = '';
        try {
          const out = await editor.save();
          const block = out.blocks[blockIndex];
          if (block) {
            md = window.MarkdownConverter.blocksToMarkdown([block]).trim();
          }
        } catch (_) {
          const blockEl = document.querySelectorAll('#editor-container .ce-block')[blockIndex];
          md = blockEl
            ? (blockEl.querySelector('.ce-block__content') || blockEl).textContent.trim()
            : '';
        }
        if (md && typeof window.webviewApi !== 'undefined') {
          window.webviewApi.postMessage({ type: 'askAI', text: md });
        }
        this._api.toolbar.close();
      });
```

With:

```javascript
      wrapper.addEventListener('click', async () => {
        if (askAIInflight) { this._api.toolbar.close(); return; }
        const blockIndex = this._api.blocks.getCurrentBlockIndex();
        let md = '';
        try {
          const out = await editor.save();
          const block = out.blocks[blockIndex];
          if (block) {
            md = window.MarkdownConverter.blocksToMarkdown([block]).trim();
          }
        } catch (_) {
          const blockEl = document.querySelectorAll('#editor-container .ce-block')[blockIndex];
          md = blockEl
            ? (blockEl.querySelector('.ce-block__content') || blockEl).textContent.trim()
            : '';
        }
        if (md) showAskAIPopup(md);
        this._api.toolbar.close();
      });
```

- [ ] **Step 4: Add `askAIError` handling and `noteLoaded` popup clear in `attachMessageHandler`**

Find `attachMessageHandler` (around line 1267). Inside its `webviewApi.onMessage` callback, find the `if (message.type === 'noteLoaded')` block and prepend `clearAskAIInflight()` as the very first line inside it:

```javascript
      if (message.type === 'noteLoaded') {
        clearAskAIInflight();   // <── add this line
        // ... rest of existing noteLoaded handling ...
```

Then add a new block after `noteLoaded` for error handling:

```javascript
      if (message.type === 'askAIError') {
        clearAskAIInflight();
        const errMsg = (message.message && typeof message.message === 'string')
          ? message.message
          : 'AI patch failed';
        const toast = document.createElement('div');
        toast.style.cssText = [
          'position:fixed',
          'bottom:16px',
          'right:16px',
          'background:#ef4444',
          'color:#fff',
          'border-radius:6px',
          'padding:8px 14px',
          'font-size:13px',
          'z-index:99999',
          'box-shadow:0 2px 8px rgba(0,0,0,0.2)',
          'max-width:320px',
          'word-break:break-word',
        ].join(';');
        toast.textContent = 'AI error: ' + errMsg;
        document.body.appendChild(toast);
        setTimeout(function () { toast.remove(); }, 4000);
      }
```

- [ ] **Step 5: Commit**

```bash
cd /Users/riskyworks/Documents/pc/joplin-notion
git add src/webview/block-editor.js
git commit -m "feat: add inline Ask AI popup with patch mode and in-flight state"
```

---

## Task 8: Manual end-to-end verification

No automated tests for the webview UI — verify manually in Joplin.

- [ ] **Step 1: Build and reload both plugins in Joplin**

```bash
cd /Users/riskyworks/Documents/pc/joplin-notion && npm run dist
cd /Users/riskyworks/Documents/pc/joplin-ai && npm run dist
```

Then in Joplin: Tools → Options → Plugins → reload both plugins.

- [ ] **Step 2: Test inline text selection → Ask AI**

1. Open a note with a few paragraphs in the block editor (Cmd+Shift+B)
2. Select some words with the mouse — the inline toolbar appears
3. Click the robot icon (Ask AI)
4. **Expected:** a small popup appears below the block with a text input
5. Type "make this more concise" and press Enter
6. **Expected:** popup shows "…", then disappears when the note reloads with the fragment updated

- [ ] **Step 3: Test block-level Ask AI via tune menu**

1. Click the block's drag handle (⋮⋮) to open the block popover
2. Click "Ask AI"
3. **Expected:** popup appears; type a prompt and confirm it patches only that block's content

- [ ] **Step 4: Test Escape dismisses popup**

1. Trigger the popup (select text → Ask AI)
2. Press Escape before typing
3. **Expected:** popup disappears, no AI call made

- [ ] **Step 5: Test error toast**

1. In joplin-ai settings, temporarily set an invalid API key
2. Trigger Ask AI with a selection and submit a prompt
3. **Expected:** popup clears; a red toast appears "AI error: ..." for ~4 seconds

- [ ] **Step 6: Final commit with version bump (optional)**

```bash
cd /Users/riskyworks/Documents/pc/joplin-notion
git add -p  # if any cleanup needed
git commit -m "chore: verify inline ask-ai patch mode end-to-end"
```
