/**
 * panel.js — Block editor webview bridge.
 * Handles Joplin host messages and forwards them to BlockEditor.
 */

(function () {
  'use strict';

  // ── Joplin message bridge ─────────────────────────────────────────────────

  window.webviewApi.onMessage((message) => {
    if (message.type === 'noteLoaded' && message.note) {
      if (typeof window.BlockEditor !== 'undefined') {
        window.BlockEditor.loadNote(message.note);
      }
    }
    if (message.type === 'error' && message.message) {
      console.error('[notion-editor] host error:', message.message);
    }
  });

  // ── Request current note on load ──────────────────────────────────────────

  window.webviewApi.postMessage({ type: 'getNote' });
})();
