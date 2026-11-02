import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
// Test selection must never fall back to an installed Desktop distribution.
const exists=fs.existsSync;
fs.existsSync=path=>String(path).startsWith('/Applications/')?false:exists(path);
syncBuiltinESMExports();
