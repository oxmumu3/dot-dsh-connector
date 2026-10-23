// The distributable native entry is management-plugin/; keep fixture use explicit.
export {name,inject,apply} from './management-plugin/index.js';
export {installConnector as applyLegacyFixture} from './src/plugin.js';
