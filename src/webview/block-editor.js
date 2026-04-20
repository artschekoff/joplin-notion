/**
 * block-editor.js  —  Phase 2
 * Editor.js + DragDrop + Vim mode
 *
 * Globals expected (loaded before this script):
 *   window.EditorJS, window.Header, window.EditorjsList,
 *   window.Checklist, window.CodeTool, window.Quote,
 *   window.Delimiter, window.DragDrop, window.MarkdownConverter
 */

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────

  /** @type {any} */
  let editor = null;
  let currentNoteId = null;
  let saveTimer = null;
  const SAVE_DEBOUNCE_MS = 1200;

  // ── Vim state ──────────────────────────────────────────────────────────────

  /** @type {'insert'|'normal'} */
  let vimMode = 'insert';
  let vimIndex = 0;         // currently selected block in normal mode
  let vimPendingKey = null; // waiting for composite (dd / gg / yy)
  let vimPendingTimer = null;
  const VIM_PENDING_MS = 600;
  /** @type {{ type: string, data: any } | null} */
  let yankBuffer = null;

  // ── Undo stack ─────────────────────────────────────────────────────────────

  /** JSON-serialised snapshots of editor states, oldest first. */
  const undoStack = [];
  const MAX_UNDO_STEPS = 50;
  /** The most-recently captured snapshot (tracks current state). */
  let currentSnapshot = null;
  /** True while an undo restore is in progress — prevents re-entrancy. */
  let isRestoringUndo = false;
  /** True after the first change; once true Cmd+Z is always intercepted. */
  let hasEverChanged = false;

  // ── TOC state ──────────────────────────────────────────────────────────────

  const TOC_STORAGE_KEY = 'be-toc-visible';
  let tocBuildTimer = null;
  const TOC_DEBOUNCE_MS = 300;
  /** @type {IntersectionObserver|null} */
  let tocObserver = null;

  // ── Save helpers ───────────────────────────────────────────────────────────

  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      if (!editor || !currentNoteId) return;
      try {
        const out = await editor.save();
        const md = window.MarkdownConverter.blocksToMarkdown(out.blocks);
        window.webviewApi.postMessage({ type: 'saveBlocks', noteId: currentNoteId, markdown: md });
      } catch (_) {}
    }, SAVE_DEBOUNCE_MS);
  };

  // ── Undo helpers ───────────────────────────────────────────────────────────

  /**
   * Captures the current editor state and pushes the previous snapshot onto
   * the undo stack.  Returns true when a new snapshot was recorded.
   *
   * Only the `blocks` array is compared/stored — EditorJS includes a `time`
   * field in save() output that changes on every call, which would create
   * phantom undo entries for unchanged content.
   */
  const captureSnapshot = async () => {
    if (!editor) return false;
    try {
      const out = await editor.save();
      const snap = JSON.stringify(out.blocks);
      if (snap !== currentSnapshot) {
        if (currentSnapshot !== null) {
          undoStack.push(currentSnapshot);
          if (undoStack.length > MAX_UNDO_STEPS) undoStack.shift();
        }
        currentSnapshot = snap;
        return true;
      }
    } catch (_) {}
    return false;
  };

  const onEditorChange = async () => {
    if (isRestoringUndo) return;
    await captureSnapshot();
  };

  /**
   * Pops the last snapshot from the undo stack and renders it.
   * Preserves the editor container's scroll position so the view does not
   * jump to the top when editor.render() replaces the DOM.
   */
  const performUndo = async () => {
    if (!editor || undoStack.length === 0) return;
    const snap = undoStack.pop();
    currentSnapshot = snap ?? null;
    isRestoringUndo = true;
    const editorEl = document.getElementById('editor-container');
    const savedScroll = editorEl ? editorEl.scrollTop : 0;
    try {
      await editor.render({ blocks: JSON.parse(snap) });
      if (editorEl) {
        editorEl.scrollTop = savedScroll;
        requestAnimationFrame(() => { editorEl.scrollTop = savedScroll; });
      }
      scheduleSave();
    } catch (_) {} finally {
      isRestoringUndo = false;
    }
  };

  // ── Vim helpers ────────────────────────────────────────────────────────────

  const vimStatusEl = () => document.getElementById('vim-mode-label');

  const updateVimUI = () => {
    const el = vimStatusEl();
    if (el) el.textContent = vimMode === 'normal' ? '-- NORMAL --' : '-- INSERT --';
    const bar = document.getElementById('vim-statusbar');
    if (bar) bar.setAttribute('data-mode', vimMode);

    // Block highlight
    document.querySelectorAll('.ce-block--vim').forEach(b => b.classList.remove('ce-block--vim'));
    if (vimMode === 'normal') {
      const blocks = document.querySelectorAll('#editor-container .ce-block');
      if (blocks[vimIndex]) blocks[vimIndex].classList.add('ce-block--vim');
    }
  };

  const clampIndex = (i) => {
    const count = editor ? editor.blocks.getBlocksCount() : 1;
    return Math.max(0, Math.min(i, count - 1));
  };

  const vimMoveTo = (i) => {
    vimIndex = clampIndex(i);
    updateVimUI();
    const blocks = document.querySelectorAll('#editor-container .ce-block');
    if (blocks[vimIndex]) blocks[vimIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const vimEnterInsert = (position = 'start') => {
    vimMode = 'insert';
    updateVimUI();
    try { editor.caret.setToBlock(vimIndex, position); } catch (_) {}
  };

  const cancelPending = () => {
    clearTimeout(vimPendingTimer);
    vimPendingKey = null;
  };

  /** @returns {boolean} true if key was consumed */
  const handleVimKey = async (e) => {
    if (vimMode !== 'normal') return false;

    const key = e.key;
    const prev = vimPendingKey;
    cancelPending();

    // ── Composite keys ────────────────────────────────────────────────────
    if (prev === 'd' && key === 'd') {
      e.preventDefault();
      if (editor.blocks.getBlocksCount() > 1) {
        editor.blocks.delete(vimIndex);
        vimIndex = clampIndex(vimIndex);
      }
      updateVimUI();
      scheduleSave();
      return true;
    }
    if (prev === 'g' && key === 'g') {
      e.preventDefault();
      vimMoveTo(0);
      return true;
    }
    if (prev === 'y' && key === 'y') {
      e.preventDefault();
      try {
        const out = await editor.save();
        const b = out.blocks[vimIndex];
        if (b) yankBuffer = { type: b.type, data: JSON.parse(JSON.stringify(b.data)) };
      } catch (_) {}
      return true;
    }

    // ── Single-key commands ───────────────────────────────────────────────
    switch (key) {
      case 'j': e.preventDefault(); vimMoveTo(vimIndex + 1); return true;
      case 'k': e.preventDefault(); vimMoveTo(vimIndex - 1); return true;
      case 'G': e.preventDefault(); vimMoveTo(editor.blocks.getBlocksCount() - 1); return true;

      case 'i': e.preventDefault(); vimEnterInsert('start'); return true;
      case 'a': e.preventDefault(); vimEnterInsert('end'); return true;

      case 'o':
        e.preventDefault();
        editor.blocks.insert('paragraph', {}, null, vimIndex + 1, true);
        vimIndex = vimIndex + 1;
        vimMode = 'insert';
        updateVimUI();
        setTimeout(() => { try { editor.caret.setToBlock(vimIndex, 'start'); } catch (_) {} }, 0);
        return true;

      case 'O':
        e.preventDefault();
        editor.blocks.insert('paragraph', {}, null, vimIndex, true);
        vimMode = 'insert';
        updateVimUI();
        setTimeout(() => { try { editor.caret.setToBlock(vimIndex, 'start'); } catch (_) {} }, 0);
        return true;

      case 'p':
        e.preventDefault();
        if (yankBuffer) {
          editor.blocks.insert(yankBuffer.type, yankBuffer.data, null, vimIndex + 1, false);
          vimMoveTo(vimIndex + 1);
          scheduleSave();
        }
        return true;

      case 'P':
        e.preventDefault();
        if (yankBuffer) {
          editor.blocks.insert(yankBuffer.type, yankBuffer.data, null, vimIndex, false);
          updateVimUI();
          scheduleSave();
        }
        return true;

      case 'u':
        e.preventDefault();
        await performUndo();
        return true;

      // Start composite
      case 'd':
      case 'g':
      case 'y':
        e.preventDefault();
        vimPendingKey = key;
        vimPendingTimer = setTimeout(cancelPending, VIM_PENDING_MS);
        return true;

      default:
        return false;
    }
  };

  const attachVimListeners = () => {
    const container = document.getElementById('editor-container');
    if (!container) return;

    // Allow programmatic focus so normal-mode keys keep e.target inside the container
    container.setAttribute('tabindex', '-1');

    // Capture phase — fires before Editor.js handlers
    document.addEventListener('keydown', async (e) => {
      if (!container.contains(e.target) && e.target !== container) return;

      if (e.key === 'Escape' && vimMode === 'insert') {
        try { vimIndex = editor.blocks.getCurrentBlockIndex(); } catch (_) {}
        if (document.activeElement) document.activeElement.blur();
        // Keep focus on the container so subsequent keydown events (hjkl) still
        // pass the container guard above and reach handleVimKey.
        container.focus();
        vimMode = 'normal';
        updateVimUI();
        e.preventDefault();
        return;
      }

      // Ctrl+Z / Cmd+Z — always intercept once any change has been made so
      // EditorJS native undo (broken by render() calls) never fires.
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        if (hasEverChanged || undoStack.length > 0) {
          e.preventDefault();
          e.stopImmediatePropagation();
          // Force-capture closes the async gap: if onEditorChange has not
          // flushed yet, this grabs the current state before we undo.
          await captureSnapshot();
          if (undoStack.length > 0) {
            await performUndo();
          }
          return;
        }
      }

      if (vimMode === 'normal') {
        await handleVimKey(e);
      }
    }, true);
  };

  // ── Editor.js init ─────────────────────────────────────────────────────────

  const initEditorJs = () => {
    if (typeof window.EditorJS === 'undefined') return false;

    const toolDefs = {
      header:    { class: window.Header,      config: { levels: [1, 2, 3], defaultLevel: 2 } },
      list:      { class: window.EditorjsList, inlineToolbar: true, config: { defaultStyle: 'unordered' } },
      checklist: { class: window.Checklist,   inlineToolbar: true },
      code:      { class: window.CodeTool },
      quote:     { class: window.Quote,       inlineToolbar: true },
      delimiter: { class: window.Delimiter },
    };
    const tools = {};
    for (const [name, def] of Object.entries(toolDefs)) {
      if (def.class) tools[name] = def;
    }
    tools.table = { class: SimpleTableTool, inlineToolbar: true };
    tools.askAI = { class: AskAIInlineTool };
    tools.askAITune = { class: AskAIBlockTune };

    editor = new window.EditorJS({
      holder: 'editor-container',
      autofocus: false,
      placeholder: 'Start writing…  (press Escape for Vim Normal mode)',
      inlineToolbar: ['bold', 'italic', 'link', 'askAI'],
      tunes: ['askAITune'],
      tools,
      onReady: () => {
        if (typeof window.DragDrop === 'function') {
          new window.DragDrop(editor);
        }
        attachVimListeners();
        updateVimUI();
        if (typeof window.webviewApi !== 'undefined') {
          window.webviewApi.postMessage({ type: 'getNote' });
        }
      },
      onChange: () => {
        hasEverChanged = true;
        onEditorChange();
        scheduleSave();
        scheduleTocBuild();
      },
    });

    return true;
  };

  // ── Public API ─────────────────────────────────────────────────────────────

  window.BlockEditor = {
    loadNote: async (note) => {
      clearTimeout(saveTimer);
      saveTimer = null;
      currentNoteId = note ? (note.id || null) : null;
      if (!editor) return;
      undoStack.length = 0;
      currentSnapshot = null;
      isRestoringUndo = false;
      hasEverChanged = false;
      try {
        await editor.isReady;
        if (!note || !note.body) { await editor.clear(); } else {
          const blocks = window.MarkdownConverter.markdownToBlocks(note.body);
          await editor.render({ blocks });
          vimIndex = 0;
          updateVimUI();
        }
      } catch (err) {
        console.error('[BlockEditor] loadNote:', err);
      }
      // Always capture the initial state — even when render fails the editor
      // still has a DOM state that the user can edit and may want to undo to.
      try {
        const out = await editor.save();
        currentSnapshot = JSON.stringify(out.blocks);
      } catch (_) {}
      buildTOC();
    },

    getMarkdown: async () => {
      if (!editor) return '';
      try {
        const out = await editor.save();
        return window.MarkdownConverter.blocksToMarkdown(out.blocks);
      } catch (_) { return ''; }
    },

    getNoteId: () => currentNoteId,

    /** Programmatic vim mode switch (called externally if needed) */
    setVimMode: (mode) => {
      vimMode = mode;
      updateVimUI();
    },

    /** Toggle the TOC panel programmatically */
    toggleTOC: () => toggleTOC(),
  };

  // ── Native Editor.js popover — first-item auto-focus ─────────────────────

  /**
   * Selector for a popover item that can receive focus.
   * Excludes hidden, disabled, and separator elements.
   */
  const FOCUSABLE_POPOVER_ITEM =
    '.ce-popover-item:not(.ce-popover-item--hidden)' +
    ':not(.ce-popover-item--disabled)' +
    ':not(.ce-popover-item-separator)';

  /** Data attribute that marks items auto-focused by us (not by arrow keys). */
  const AUTO_FOCUS_ATTR = 'data-be-auto-focused';

  /** Focus the first selectable item in the given popover element. */
  const focusFirstPopoverItem = (popover) => {
    popover.querySelectorAll(`[${AUTO_FOCUS_ATTR}]`).forEach(el => {
      el.removeAttribute(AUTO_FOCUS_ATTR);
      el.classList.remove('ce-popover-item--focused');
    });
    const first = popover.querySelector(FOCUSABLE_POPOVER_ITEM);
    if (first) {
      first.classList.add('ce-popover-item--focused');
      first.setAttribute(AUTO_FOCUS_ATTR, '1');
    }
  };

  /**
   * Move popover keyboard focus by `delta` (+1 forward, -1 backward).
   * Wraps around. Skips hidden/disabled items.
   */
  const movePopoverFocus = (popover, delta) => {
    const items = Array.from(popover.querySelectorAll(FOCUSABLE_POPOVER_ITEM));
    if (items.length === 0) return;
    const currentIdx = items.findIndex(el => el.classList.contains('ce-popover-item--focused'));
    const nextIdx = (currentIdx + delta + items.length) % items.length;
    items.forEach(el => {
      el.classList.remove('ce-popover-item--focused');
      el.removeAttribute(AUTO_FOCUS_ATTR);
    });
    // Do NOT set AUTO_FOCUS_ATTR here — this is user-initiated navigation.
    // Without the attribute the observer will leave this item alone.
    items[nextIdx].classList.add('ce-popover-item--focused');
    items[nextIdx].scrollIntoView?.({ block: 'nearest' });
  };

  // ── Popover search state ──────────────────────────────────────────────────

  let popoverSearchQuery = '';

  const SEARCH_INDICATOR_CLASS = 'be-popover-search-indicator';

  /** Single printable character (length-1, no control/meta). */
  const isPrintableKey = (e) =>
    e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;

  /** Get the text label of a popover item. */
  const getItemLabel = (item) => {
    const title = item.querySelector('.ce-popover-item__title');
    return (title ? title.textContent : item.textContent || '').toLowerCase();
  };

  /** Marker for items hidden by our search (not by Editor.js). */
  const SEARCH_HIDDEN_ATTR = 'data-be-search-hidden';

  /** Apply the current search query to popover items. */
  const applyPopoverFilter = (popover) => {
    const query = popoverSearchQuery.toLowerCase();
    const items = popover.querySelectorAll('.ce-popover-item');
    items.forEach(item => {
      if (!query) {
        if (item.hasAttribute(SEARCH_HIDDEN_ATTR)) {
          item.removeAttribute(SEARCH_HIDDEN_ATTR);
          item.classList.remove('ce-popover-item--hidden');
        }
      } else {
        const label = getItemLabel(item);
        if (label.includes(query)) {
          if (item.hasAttribute(SEARCH_HIDDEN_ATTR)) {
            item.removeAttribute(SEARCH_HIDDEN_ATTR);
            item.classList.remove('ce-popover-item--hidden');
          }
        } else if (!item.hasAttribute(SEARCH_HIDDEN_ATTR)) {
          item.setAttribute(SEARCH_HIDDEN_ATTR, '1');
          item.classList.add('ce-popover-item--hidden');
        }
      }
    });
    updateSearchIndicator(popover);
    focusFirstPopoverItem(popover);
  };

  /** Show or remove the search indicator inside the popover. */
  const updateSearchIndicator = (popover) => {
    let indicator = popover.querySelector('.' + SEARCH_INDICATOR_CLASS);
    if (!popoverSearchQuery) {
      if (indicator) indicator.remove();
      return;
    }
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = SEARCH_INDICATOR_CLASS;
      popover.prepend(indicator);
    }
    indicator.textContent = popoverSearchQuery;
  };

  /** Reset search state and un-hide all items. */
  const resetPopoverSearch = (popover) => {
    if (!popoverSearchQuery) return;
    popoverSearchQuery = '';
    if (popover) applyPopoverFilter(popover);
  };

  const attachPopoverBehavior = () => {
    // MutationObserver: whenever the popover opens or its items change,
    // auto-focus the first visible item.
    /** Tracks whether we saw an open popover last tick. */
    let wasPopoverOpen = false;

    const observer = new MutationObserver(() => {
      try {
        if (!document.body) return;
        const popover = document.querySelector('.ce-popover--opened');
        if (!popover) {
          popoverSearchQuery = '';
          wasPopoverOpen = false;
          return;
        }
        // Popover just (re-)opened — clear stale search state.
        if (!wasPopoverOpen) {
          wasPopoverOpen = true;
          popoverSearchQuery = '';
          // Un-hide only items hidden by our search, not by Editor.js.
          popover.querySelectorAll(`[${SEARCH_HIDDEN_ATTR}]`).forEach(el => {
            el.removeAttribute(SEARCH_HIDDEN_ATTR);
            el.classList.remove('ce-popover-item--hidden');
          });
          const indicator = popover.querySelector('.' + SEARCH_INDICATOR_CLASS);
          if (indicator) indicator.remove();
        }
        const focused = popover.querySelector('.ce-popover-item--focused');
        // User navigated manually (no AUTO_FOCUS_ATTR) — respect their choice.
        if (focused && !focused.hasAttribute(AUTO_FOCUS_ATTR)) return;
        const first = popover.querySelector(FOCUSABLE_POPOVER_ITEM);
        if (!first) return;
        // First item is already correctly focused — stop here (prevents infinite loop
        // where classList.add triggers the observer which calls this again).
        if (focused === first) return;
        focusFirstPopoverItem(popover);
      } catch (_) {}
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });

    // Capture-phase search handler: printable keys, Backspace, Escape.
    document.addEventListener('keydown', (e) => {
      const popover = document.querySelector('.ce-popover--opened');
      if (!popover) return;

      if (e.key === 'Escape' && popoverSearchQuery) {
        e.preventDefault();
        e.stopImmediatePropagation();
        resetPopoverSearch(popover);
        return;
      }
      if (e.key === 'Backspace' && popoverSearchQuery) {
        e.preventDefault();
        e.stopImmediatePropagation();
        popoverSearchQuery = popoverSearchQuery.slice(0, -1);
        applyPopoverFilter(popover);
        return;
      }
      if (isPrintableKey(e) && e.key !== ' ') {
        e.preventDefault();
        e.stopImmediatePropagation();
        popoverSearchQuery += e.key;
        applyPopoverFilter(popover);
        return;
      }
    }, true);

    // Capture-phase Tab / Shift+Tab handler: cycle through popover items.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const popover = document.querySelector('.ce-popover--opened');
      if (!popover) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      movePopoverFocus(popover, e.shiftKey ? -1 : +1);
    }, true);

    // Capture-phase Enter handler: when the popover is open, click the focused
    // (or first) item and block propagation so EditorJS does not also insert a
    // new paragraph via its default Enter behaviour.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const popover = document.querySelector('.ce-popover--opened');
      if (!popover) return;
      const focused = popover.querySelector(
        '.ce-popover-item--focused:not(.ce-popover-item--hidden)',
      );
      const first = popover.querySelector(FOCUSABLE_POPOVER_ITEM);
      if (!first) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      (focused || first).click();
    }, true);
  };

  // ── Simple Table Editor.js block tool ──────────────────────────────────

  /**
   * Lightweight Editor.js block tool for rendering markdown tables.
   * Stores data as `{ withHeadings: boolean, content: string[][] }`.
   * Cells are contenteditable so users can edit text inline.
   */
  class SimpleTableTool {
    static get toolbox() {
      return {
        title: 'Table',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>',
      };
    }

    constructor({ data }) {
      this._data = {
        withHeadings: data.withHeadings ?? true,
        content: Array.isArray(data.content) && data.content.length > 0
          ? data.content
          : [['', ''], ['', '']],
      };
    }

    render() {
      const wrapper = document.createElement('div');
      wrapper.classList.add('be-table-wrapper');
      const table = document.createElement('table');
      table.classList.add('be-table');
      this._data.content.forEach((row, ri) => {
        const tr = document.createElement('tr');
        row.forEach((cell) => {
          const td = document.createElement(ri === 0 && this._data.withHeadings ? 'th' : 'td');
          td.innerHTML = cell;
          td.contentEditable = 'true';
          tr.appendChild(td);
        });
        table.appendChild(tr);
      });
      wrapper.appendChild(table);
      this._table = table;
      return wrapper;
    }

    save() {
      if (!this._table) return this._data;
      const rows = Array.from(this._table.querySelectorAll('tr'));
      const content = rows.map((tr) =>
        Array.from(tr.querySelectorAll('th, td')).map((cell) => cell.innerHTML.trim()),
      );
      return { withHeadings: this._data.withHeadings, content };
    }

    static get isReadOnlySupported() { return true; }
  }

  // ── "Ask AI" Editor.js inline tool ──────────────────────────────────────

  const ROBOT_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" ' +
    'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/>' +
    '<line x1="12" y1="7" x2="12" y2="11"/>' +
    '<line x1="8" y1="16" x2="8" y2="16.01"/>' +
    '<line x1="16" y1="16" x2="16" y2="16.01"/></svg>';

  /**
   * Custom Editor.js inline tool that sends the selected text to the AI
   * chat panel.  Appears in the same toolbar as Bold / Italic / Link.
   */
  class AskAIInlineTool {
    static get isInline() { return true; }
    static get title() { return 'Ask AI'; }
    static get sanitize() { return {}; }

    render() {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.innerHTML = ROBOT_SVG;
      btn.classList.add('ce-inline-tool');
      btn.title = 'Ask AI';
      this._button = btn;
      return btn;
    }

    surround(range) {
      if (!range) return;
      const text = range.toString().trim();
      if (text && typeof window.webviewApi !== 'undefined') {
        window.webviewApi.postMessage({ type: 'askAI', text });
      }
    }

    checkState() { return false; }
  }

  /**
   * Editor.js block tune — adds "Ask AI" to every block's settings popover
   * (the ⋮⋮ menu).  Sends the block's text content to the AI chat panel.
   */
  class AskAIBlockTune {
    static get isTune() { return true; }

    constructor({ api, block }) {
      this._api = api;
      this._block = block;
    }

    render() {
      const wrapper = document.createElement('div');
      wrapper.classList.add('ce-popover-item');
      wrapper.innerHTML =
        '<div class="ce-popover-item__icon">' + ROBOT_SVG + '</div>' +
        '<div class="ce-popover-item__title">Ask AI</div>';
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
      return wrapper;
    }

    save() { return undefined; }
  }

  // ── Message handler (standalone panel — receives messages from backend) ──

  const attachMessageHandler = () => {
    if (typeof window.webviewApi === 'undefined') return;
    window.webviewApi.onMessage((event) => {
      const message = event && event.message && event.message.type ? event.message : event;
      if (!message) return;
      if (message.type === 'noteLoaded') {
        const note = message.note || null;
        if (window.BlockEditor) window.BlockEditor.loadNote(note);
      }
    });
  };

  // ── TOC helpers ────────────────────────────────────────────────────────────

  /**
   * Strips HTML tags from a string, returning plain text suitable for display.
   * @param {string} html
   * @returns {string}
   */
  const stripHtml = (html) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = html || '';
    return tmp.textContent || tmp.innerText || '';
  };

  /**
   * Rebuilds the TOC list from the current editor blocks.
   * Attaches IntersectionObserver on heading DOM elements for scroll-spy.
   */
  const buildTOC = async () => {
    const tocList = document.getElementById('toc-list');
    if (!tocList || !editor) return;

    let blocks = [];
    try {
      const out = await editor.save();
      blocks = out.blocks || [];
    } catch (_) { return; }

    const headings = blocks
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => block.type === 'header');

    tocList.innerHTML = '';

    if (headings.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'toc-empty';
      empty.textContent = 'No headings';
      tocList.appendChild(empty);
      if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }
      return;
    }

    headings.forEach(({ block, index }) => {
      const level = block.data.level || 2;
      const text = stripHtml(block.data.text);
      const item = document.createElement('div');
      item.className = 'toc-item';
      item.dataset.level = String(level);
      item.dataset.blockIndex = String(index);
      item.textContent = text || '(untitled)';
      item.title = text;
      item.addEventListener('click', () => scrollToHeading(index, item));
      tocList.appendChild(item);
    });

    attachScrollSpy(headings.map(({ index }) => index));
  };

  /**
   * Smooth-scrolls to the heading block at the given Editor.js block index.
   * @param {number} blockIndex
   * @param {HTMLElement} [tocItem]
   */
  const scrollToHeading = (blockIndex, tocItem) => {
    const editorEl = document.getElementById('editor-container');
    if (!editorEl) return;
    const blocks = editorEl.querySelectorAll('.ce-block');
    const target = blocks[blockIndex];
    if (!target) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const tocList = document.getElementById('toc-list');
    if (tocList) {
      tocList.querySelectorAll('.toc-item--active').forEach((el) => el.classList.remove('toc-item--active'));
    }
    if (tocItem) tocItem.classList.add('toc-item--active');
  };

  /**
   * Watches heading blocks with IntersectionObserver and updates the active
   * TOC item as the user scrolls through the document.
   * @param {number[]} blockIndices
   */
  const attachScrollSpy = (blockIndices) => {
    if (tocObserver) tocObserver.disconnect();
    const editorEl = document.getElementById('editor-container');
    const tocList = document.getElementById('toc-list');
    if (!editorEl || !tocList || blockIndices.length === 0) return;

    const allBlocks = editorEl.querySelectorAll('.ce-block');
    const targets = blockIndices
      .map((i) => allBlocks[i])
      .filter(Boolean);

    if (targets.length === 0) return;

    tocObserver = new IntersectionObserver(
      (entries) => {
        let topmost = null;
        let topmostTop = Infinity;
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const rect = entry.boundingClientRect;
            if (rect.top < topmostTop) {
              topmostTop = rect.top;
              topmost = entry.target;
            }
          }
        });
        if (!topmost) return;
        const idx = Array.from(allBlocks).indexOf(topmost);
        const tocItems = tocList.querySelectorAll('.toc-item');
        tocItems.forEach((item) => {
          const matches = Number(item.dataset.blockIndex) === idx;
          item.classList.toggle('toc-item--active', matches);
        });
      },
      { root: editorEl, threshold: 0.1 },
    );

    targets.forEach((el) => tocObserver.observe(el));
  };

  /**
   * Schedules a debounced TOC rebuild (called from onChange).
   */
  const scheduleTocBuild = () => {
    clearTimeout(tocBuildTimer);
    tocBuildTimer = setTimeout(() => buildTOC(), TOC_DEBOUNCE_MS);
  };

  /**
   * Toggles the TOC panel visibility and persists the preference.
   */
  const toggleTOC = () => {
    const panel = document.getElementById('toc-panel');
    const btn = document.getElementById('toc-toggle-btn');
    if (!panel) return;
    const isVisible = !panel.classList.contains('toc-hidden');
    panel.classList.toggle('toc-hidden', isVisible);
    if (btn) btn.classList.toggle('toc-active', !isVisible);
    try { localStorage.setItem(TOC_STORAGE_KEY, String(!isVisible)); } catch (_) {}
    if (!isVisible) buildTOC();
  };

  /**
   * Restores the TOC visibility preference from localStorage and wires the
   * toggle button click handler.
   */
  const initTOC = () => {
    const btn = document.getElementById('toc-toggle-btn');
    if (btn) btn.addEventListener('click', toggleTOC);

    let savedVisible = false;
    try { savedVisible = localStorage.getItem(TOC_STORAGE_KEY) === 'true'; } catch (_) {}
    if (savedVisible) {
      const panel = document.getElementById('toc-panel');
      if (panel) panel.classList.remove('toc-hidden');
      if (btn) btn.classList.add('toc-active');
    }
  };

  // ── List cross-item selection patch ────────────────────────────────────────
  //
  // @editorjs/list sets contentEditable on each .cdx-list__item-content div.
  // Browsers cannot extend a text selection across separate contentEditable
  // boundaries.  By promoting contentEditable to the parent .cdx-list wrapper,
  // all items share one editable region and drag-selection works normally.

  const patchListContentEditable = () => {
    const container = document.getElementById('editor-container');
    if (!container) return;
    const apply = () => {
      container.querySelectorAll('.cdx-list:not([contenteditable])').forEach(list => {
        list.setAttribute('contenteditable', 'true');
      });
    };
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(container, { childList: true, subtree: true });
  };

  // ── Boot ───────────────────────────────────────────────────────────────────

  const boot = () => {
    initTOC();
    attachPopoverBehavior();
    attachMessageHandler();
    patchListContentEditable();

    if (!initEditorJs()) {
      setTimeout(() => { if (!initEditorJs()) console.error('[BlockEditor] EditorJS failed to load'); }, 500);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
