/**
 * panel.js
 * AI Chat pane + bridge between Joplin postMessage API and BlockEditor.
 */

(function () {
  'use strict';

  // ── Resizable divider ───────────────────────────────────────────────────
  const resizer = document.getElementById('resizer');
  const editorPane = document.getElementById('editor-pane');
  const chatPane = document.getElementById('chat-pane');
  let isResizing = false;

  resizer.addEventListener('mousedown', () => {
    isResizing = true;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const appRect = document.getElementById('app').getBoundingClientRect();
    const offset = e.clientX - appRect.left;
    const total = appRect.width;
    const editorPct = Math.min(Math.max((offset / total) * 100, 20), 80);
    editorPane.style.flex = `0 0 ${editorPct}%`;
    chatPane.style.flex = `0 0 ${100 - editorPct - 0.3}%`;
  });

  document.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    resizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  // ── Joplin message bridge ───────────────────────────────────────────────
  window.webviewApi.onMessage((message) => {
    if (message.type === 'loadNote' && message.note) {
      window.BlockEditor.loadNote(message.note);
    }
  });

  // ── Send button ─────────────────────────────────────────────────────────
  const sendBtn = document.getElementById('send-btn');
  const promptInput = document.getElementById('prompt-input');

  const sendMessage = () => {
    const text = promptInput.value.trim();
    if (!text) return;
    appendMessage('user', text);
    promptInput.value = '';
    // TODO: Phase 4 — wire to AI service via postMessage execute
    window.webviewApi.postMessage({ type: 'execute', prompt: text });
  };

  sendBtn.addEventListener('click', sendMessage);
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // ── Message rendering ───────────────────────────────────────────────────
  const appendMessage = (role, text) => {
    const messages = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = `message message-${role}`;
    el.textContent = text;
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
  };

  // ── Request current note on load ────────────────────────────────────────
  window.webviewApi.postMessage({ type: 'getNote' }).then((note) => {
    if (note) window.BlockEditor.loadNote(note);
  });
})();
