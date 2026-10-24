import {defineConfig} from 'vite';
import {macControllerPlugin} from './scripts/controller-plugin.ts';
export default defineConfig({plugins:[macControllerPlugin()]});
