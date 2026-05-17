# Ask AI — Inline Patch Mode

**Date:** 2026-05-17  
**Status:** Approved  
**Scope:** joplin-notion + joplin-ai

## Problem

When the user selects a block or text fragment in the block editor and clicks "Ask AI", the AI currently receives the full note and has no constraint to modify only the selected portion. There is also no inline prompt UX — the user must switch to the joplin-ai chat panel manually.

The goal is a Notion-style inline AI flow: a floating prompt input appears near the selected block, the user types an instruction, and the AI patches only the selected fragment in-place.

## Data Flow

```
[block-editor.js / joplin-notion]
  User selects text (AskAIInlineTool) or opens block menu (AskAIBlockTune)
  → Inline popup appears anchored below the active block
  → User types prompt, presses Enter
  → postMessage({ type: 'askAI', text, prompt, isSelection: true })

[panel.ts / joplin-notion]
  Handles 'askAI' message
  → writes notion.askAI.request = JSON.stringify({ text, prompt, isSelection: true, ts })

[index.ts / joplin-ai]  ← NEW: joplin.settings.onChange listener
  Reads globalValue('notion.askAI.request')
  Guards against stale ts (stores lastProcessedTs)
  → calls executeWithSelection(text, prompt)

[panel.ts / joplin-ai]  ← NEW: executeWithSelection()
  setEditorSelection(text)
  handleExecute(chatPanelHandle, prompt, history=[], workMode='edit')
  → isSelection=true, selectionText=text passed into ActionContext
  → buildSystemPromptParts embeds >>>SELECTED<<< / <<<END_SELECTED>>> markers
  → AI sees full note body with selection marked
  → AI calls update_note with patched body (selected region replaced, rest unchanged)
  → Joplin note data updated

[panel.ts / joplin-notion — onNoteChange]
  → sendNoteLoaded() → block editor reloads note → updated block displayed
```

## Components

### joplin-notion / `block-editor.js`

- `AskAIInlineTool.surround()` and `AskAIBlockTune` click handler: instead of immediately posting, render an inline popup.
- **Popup:** floating `<div>` anchored below the active block. Contains:
  - A single-line text input ("What should AI do with this?")
  - Run button (disabled until input is non-empty)
  - Escape key or click-outside dismisses
- On submit: `postMessage({ type: 'askAI', text, prompt, isSelection: true })`
- While in-flight: show a subtle "thinking…" indicator on the block; disable popup and both AskAI entry points
- On `noteLoaded` message received: clear popup and spinner (success or error path)
- On `askAIError` message received: show brief error toast on block, re-enable entry points

### joplin-notion / `panel.ts`

- `askAI` message handler: extend setting payload from `{ text, ts }` to `{ text, prompt, isSelection, ts }`
- No other changes.

### joplin-ai / `index.ts`

- Add `await joplin.settings.onChange(async () => { ... })` listener after `initPanel()`
- Inside listener:
  - Read `await joplin.settings.globalValue('notion.askAI.request')`
  - Parse JSON → `{ text, prompt, isSelection, ts }`
  - Guard: skip if `ts === lastProcessedTs` or `!prompt?.trim()` or `!text?.trim()`
  - Store `lastProcessedTs = ts`
  - Call `await executeWithSelection(text, prompt)`

### joplin-ai / `panel.ts`

- New export: `executeWithSelection(text: string, prompt: string): Promise<void>`
  - Early return if `!chatPanelHandle || !text.trim() || !prompt.trim()`
  - `setEditorSelection(text)` — sets `editorSelection` module-level var
  - `await handleExecute(chatPanelHandle, prompt, [], undefined, 'edit')`
  - Does NOT show or toggle the chat panel
- On error in `handleExecute`: write `notion.askAI.error = JSON.stringify({ message, ts: Date.now() })` global setting so joplin-notion can surface it on the block

## Error Handling

| Scenario | Handling |
|---|---|
| Stale/duplicate `ts` | joplin-ai skips request silently |
| Empty prompt | Popup Run button disabled; `executeWithSelection` early-returns |
| Fragment not found in note | `embedSelectionMarkers` returns full body unmarked; AI may edit more broadly — acceptable, user can undo |
| AI/network error | `handleExecute` catches; joplin-ai writes `notion.askAI.error` setting; block editor shows toast |
| Rapid repeated clicks | Popup and both AskAI entry points disabled while request in flight |
| AI panel visibility | `executeWithSelection` runs silently regardless of panel state |
| Mode conflict | `executeWithSelection` always forces `workMode = 'edit'` |

## New Global Settings

| Key | Owner | Shape | Purpose |
|---|---|---|---|
| `notion.askAI.request` | joplin-notion writes, joplin-ai reads | `{ text, prompt, isSelection, ts }` | Trigger AI with selected fragment + prompt |
| `notion.askAI.error` | joplin-ai writes, joplin-notion reads | `{ message, ts }` | Surface AI errors back to block editor |

`notion.askAI.error` must be registered in joplin-notion's `index.ts` as a public global string setting (same pattern as `notion.askAI.request`).

## What Is Not Changing

- joplin-ai's existing `isSelection` / `selectionText` / `embedSelectionMarkers` / selection rules — used as-is
- `update_note` registry handler's patch-on-selection logic — used as-is
- The joplin-ai chat panel UI — not affected by silent `executeWithSelection` path
- `AskAIInlineTool` and `AskAIBlockTune` registration in EditorJS config — same, only click behavior changes

## File Change Summary

| File | Repo | Change |
|---|---|---|
| `src/webview/block-editor.js` | joplin-notion | Inline popup UI, in-flight state, error toast |
| `src/panel.ts` | joplin-notion | Extend `askAI` payload; register `notion.askAI.error` setting |
| `src/index.ts` | joplin-notion | Register `notion.askAI.error` setting (or in panel.ts init) |
| `src/index.ts` | joplin-ai | `joplin.settings.onChange` listener → `executeWithSelection` |
| `src/panel.ts` | joplin-ai | New `executeWithSelection` export; error writeback |
