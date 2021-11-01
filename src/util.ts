import { platform } from 'os';
import * as vscode from 'vscode';

/**
 * Returns a node module installed with VSCode, or null if it fails.
 * SOURCE: https://github.com/microsoft/vscode/issues/84439#issuecomment-552328194
 */
export function getCoreNodeModule(moduleName: string) {
  try {
    return require(`${vscode.env.appRoot}/node_modules.asar/${moduleName}`);
  } catch (err) {}

  try {
    return require(`${vscode.env.appRoot}/node_modules/${moduleName}`);
  } catch (err) {}

  return null;
}

export function isWindows() {
  return platform() === 'win32';
}

export function fixFsPath(path: string) {
  if (isWindows()) {
    return path.replace(/\\/g, '\\\\');
  }
  return path;
}

/**
 * These functions come from the following libraries:
 *
 * - ansi-regex: https://www.npmjs.com/package/ansi-regex
 *
 * - strip-ansi: https://www.npmjs.com/package/strip-ansi
 *
 * Normally I would have just imported them, but for some reason it throws an error when I try to
 */

function ansiRegex() {
  const pattern = [
    '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
    '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))',
  ].join('|');

  return new RegExp(pattern, 'g');
}

export function stripAnsi(data: string) {
  return data.replace(ansiRegex(), '');
}
