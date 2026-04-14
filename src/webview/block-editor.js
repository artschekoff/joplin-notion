/**
 * block-editor.js
 * Phase 1 stub — will be replaced with full Editor.js integration.
 * Exposes window.BlockEditor for panel.js to interact with.
 */

(function () {
  'use strict';

  // Placeholder until Editor.js UMD is loaded in Phase 1
  window.BlockEditor = {
    /** Load note content into the editor */
    loadNote: (note) => {
      const container = document.getElementById('editor-container');
      if (!container) return;
      // Phase 1: will call editor.render(markdownToBlocks(note.body))
      container.textContent = note ? note.body : '';
    },

    /** Return current editor content as Markdown */
    getMarkdown: () => {
      // Phase 1: will call editor.save() → blocksToMarkdown()
      const container = document.getElementById('editor-container');
      return container ? container.textContent : '';
    },
  };
})();
