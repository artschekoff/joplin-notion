/**
 * markdown-converter.js
 * Bidirectional converter: Markdown <-> Editor.js block JSON.
 * Phase 2 implementation — stub in Phase 1.
 */

(function () {
  'use strict';

  /**
   * Convert Markdown string to Editor.js OutputData blocks.
   * @param {string} markdown
   * @returns {{ time: number, blocks: Array, version: string }}
   */
  const markdownToBlocks = (markdown) => {
    const lines = markdown.split('\n');
    const blocks = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Headings
      const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
      if (headingMatch) {
        blocks.push({
          type: 'header',
          data: { text: headingMatch[2], level: headingMatch[1].length },
        });
        continue;
      }

      // Unordered list items
      if (/^[-*+]\s+/.test(line)) {
        const text = line.replace(/^[-*+]\s+/, '');
        blocks.push({ type: 'list', data: { style: 'unordered', items: [text] } });
        continue;
      }

      // Ordered list items
      if (/^\d+\.\s+/.test(line)) {
        const text = line.replace(/^\d+\.\s+/, '');
        blocks.push({ type: 'list', data: { style: 'ordered', items: [text] } });
        continue;
      }

      // Checklist
      if (/^-\s+\[[ x]\]\s+/.test(line)) {
        const checked = /\[x\]/.test(line);
        const text = line.replace(/^-\s+\[[ x]\]\s+/, '');
        blocks.push({ type: 'checklist', data: { items: [{ text, checked }] } });
        continue;
      }

      // Code block (opening fence)
      if (line.startsWith('```')) {
        const lang = line.slice(3).trim();
        const codeLines = [];
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        blocks.push({ type: 'code', data: { code: codeLines.join('\n'), language: lang } });
        continue;
      }

      // Blockquote
      if (line.startsWith('> ')) {
        blocks.push({ type: 'quote', data: { text: line.slice(2), caption: '' } });
        continue;
      }

      // Divider
      if (/^---+$/.test(line.trim())) {
        blocks.push({ type: 'delimiter', data: {} });
        continue;
      }

      // Empty line — skip
      if (line.trim() === '') continue;

      // Paragraph (default)
      blocks.push({ type: 'paragraph', data: { text: line } });
    }

    return { time: Date.now(), blocks, version: '2.28.0' };
  };

  /**
   * Convert Editor.js OutputData blocks to Markdown string.
   * @param {{ blocks: Array }} outputData
   * @returns {string}
   */
  const blocksToMarkdown = ({ blocks }) => {
    const lines = [];

    for (const block of blocks) {
      switch (block.type) {
        case 'header':
          lines.push(`${'#'.repeat(block.data.level)} ${block.data.text}`);
          break;
        case 'paragraph':
          lines.push(block.data.text);
          break;
        case 'list':
          if (block.data.style === 'ordered') {
            block.data.items.forEach((item, idx) => lines.push(`${idx + 1}. ${item}`));
          } else {
            block.data.items.forEach((item) => lines.push(`- ${item}`));
          }
          break;
        case 'checklist':
          block.data.items.forEach((item) =>
            lines.push(`- [${item.checked ? 'x' : ' '}] ${item.text}`)
          );
          break;
        case 'code':
          lines.push(`\`\`\`${block.data.language || ''}`);
          lines.push(block.data.code);
          lines.push('```');
          break;
        case 'quote':
          lines.push(`> ${block.data.text}`);
          break;
        case 'delimiter':
          lines.push('---');
          break;
        default:
          if (block.data.text) lines.push(block.data.text);
      }
      lines.push('');
    }

    return lines.join('\n').trimEnd();
  };

  window.MarkdownConverter = { markdownToBlocks, blocksToMarkdown };
})();
