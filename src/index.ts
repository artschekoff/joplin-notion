import joplin from 'api';
import { initPanel } from './panel';

joplin.plugins.register({
	onStart: async () => {
		await initPanel();
	},
});
