import joplin from 'api';
import { MenuItemLocation, SettingItemType, ToolbarButtonLocation } from 'api/types';
import { initPanel, toggleBlockEditorPane } from './panel';
import { shareCurrentNote } from './export';

joplin.plugins.register({
	onStart: async () => {
		// ── Global settings used as inter-plugin communication bus ──────────────
		// joplin-ai reads these via joplin.settings.globalValue()
		await joplin.settings.registerSettings({
			'notion.blockEditor.active': {
				value: false,
				type: SettingItemType.Bool,
				public: true,
				label: 'Notion Block Editor: active',
				description: 'True when the block editor panel is visible. Read by other plugins.',
			},
			'notion.askAI.request': {
				value: '',
				type: SettingItemType.String,
				public: true,
				label: 'Notion Block Editor: Ask AI request',
				description:
					'JSON {text, ts} written when user triggers Ask AI from the block editor.',
			},
		});

		await initPanel();

		// ── Block editor toggle ──────────────────────────────────────────────────

		await joplin.commands.register({
			name: 'notionToggleBlockEditor',
			label: 'Toggle Block Editor',
			iconName: 'fas fa-th-large',
			execute: async () => {
				await toggleBlockEditorPane();
			},
		});

		await joplin.views.menuItems.create(
			'notionBlockEditorMenuItem',
			'notionToggleBlockEditor',
			MenuItemLocation.Tools,
			{ accelerator: 'CmdOrCtrl+Shift+B' },
		);

		await joplin.views.toolbarButtons.create(
			'notionBlockEditorBtn',
			'notionToggleBlockEditor',
			ToolbarButtonLocation.NoteToolbar,
		);

		// ── Export commands ──────────────────────────────────────────────────────

		await joplin.commands.register({
			name: 'notionShareNoteAsText',
			label: 'Share note — Email as text',
			iconName: 'fas fa-envelope',
			execute: async () => {
				try {
					await shareCurrentNote('text');
				} catch (err) {
					const msg = err instanceof Error ? err.message : 'Failed to share note as text.';
					await joplin.views.dialogs.showMessageBox(msg);
				}
			},
		});

		await joplin.commands.register({
			name: 'notionShareNoteAsPdf',
			label: 'Export note as PDF',
			iconName: 'fas fa-file-pdf',
			execute: async () => {
				try {
					await shareCurrentNote('pdf');
				} catch (err) {
					const msg = err instanceof Error ? err.message : 'Failed to export note as PDF.';
					await joplin.views.dialogs.showMessageBox(msg);
				}
			},
		});

		await joplin.commands.register({
			name: 'notionExportNoteAsDoc',
			label: 'Export note as DOCX',
			iconName: 'fas fa-file-word',
			execute: async () => {
				try {
					await shareCurrentNote('doc');
				} catch (err) {
					const msg =
						err instanceof Error ? err.message : 'Failed to export note as DOCX.';
					await joplin.views.dialogs.showMessageBox(msg);
				}
			},
		});

		await joplin.commands.register({
			name: 'notionExportNoteAsRtf',
			label: 'Export note as RTF',
			iconName: 'fas fa-file-alt',
			execute: async () => {
				try {
					await shareCurrentNote('rtf');
				} catch (err) {
					const msg = err instanceof Error ? err.message : 'Failed to export note as RTF.';
					await joplin.views.dialogs.showMessageBox(msg);
				}
			},
		});

		await joplin.views.menuItems.create(
			'notionShareNoteAsTextMenuItem',
			'notionShareNoteAsText',
			MenuItemLocation.Tools,
		);

		await joplin.views.menuItems.create(
			'notionShareNoteAsPdfMenuItem',
			'notionShareNoteAsPdf',
			MenuItemLocation.Tools,
		);

		await joplin.views.menuItems.create(
			'notionExportNoteAsDocMenuItem',
			'notionExportNoteAsDoc',
			MenuItemLocation.Tools,
		);

		await joplin.views.menuItems.create(
			'notionExportNoteAsRtfMenuItem',
			'notionExportNoteAsRtf',
			MenuItemLocation.Tools,
		);

		await joplin.views.toolbarButtons.create(
			'notionShareNoteAsTextBtn',
			'notionShareNoteAsText',
			ToolbarButtonLocation.NoteToolbar,
		);

		await joplin.views.toolbarButtons.create(
			'notionShareNoteAsPdfBtn',
			'notionShareNoteAsPdf',
			ToolbarButtonLocation.NoteToolbar,
		);

		await joplin.views.toolbarButtons.create(
			'notionExportNoteAsDocBtn',
			'notionExportNoteAsDoc',
			ToolbarButtonLocation.NoteToolbar,
		);

		await joplin.views.toolbarButtons.create(
			'notionExportNoteAsRtfBtn',
			'notionExportNoteAsRtf',
			ToolbarButtonLocation.NoteToolbar,
		);
	},
});
