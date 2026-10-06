import { definePreset } from '../plugin.mjs';

// Applied when mhproto.yaml has no `presets` key. Set `presets: []` to start from nothing.
export default definePreset({ plugins: ['openapi'] });
