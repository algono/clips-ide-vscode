import * as vscode from 'vscode';

type LogLevel = 'off' | 'log' | 'verbose';

function getLogLevel(): LogLevel | undefined {
  return vscode.workspace.getConfiguration('clips').get('logLevel');
}

export function log(...args: Parameters<Console['log']>) {
  if (getLogLevel() === 'off') {
    return;
  }
  console.log(...args);
}

export function logVerbose(...args: Parameters<Console['log']>) {
  if (getLogLevel() !== 'verbose') {
    return;
  }
  console.log(...args);
}
