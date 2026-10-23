import {existsSync} from 'node:fs';
// Fixed official Desktop runtime. Never accept a renderer-supplied executable or alter PATH.
export const BUNDLED_PYTHON='/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/python/bin/python3.12';
export function selectPythonExecutable({platform=process.platform,exists=existsSync}={}){
 return platform==='darwin'&&exists(BUNDLED_PYTHON)?BUNDLED_PYTHON:'python3';
}
export async function pythonExecutable(){return selectPythonExecutable();}
