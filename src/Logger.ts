import * as vscode from 'vscode';

type LogLevel = 'off' | 'error' | 'log' | 'verbose';

const outputChannel: vscode.OutputChannel =
  vscode.window.createOutputChannel('CLIPS');

function getLogLevel(): LogLevel | undefined {
  return vscode.workspace.getConfiguration('clips').get('logLevel');
}

function logToOutputChannel(message: string, show: boolean = false): void {
  outputChannel.appendLine(message);

  if (show) {
    outputChannel.show();
  }
}

export function log(...args: Parameters<Console['log']>): void {
  const logLevel = getLogLevel();

  if (logLevel === 'off' || logLevel === 'error') {
    return;
  }

  console.log(...args);
  logToOutputChannel(args.join(' '));
}

export function logError(...args: Parameters<Console['error']>): void {
  if (getLogLevel() === 'off') {
    return;
  }

  console.error(...args);
  console.log(...args);

  logToOutputChannel(args.join(' '), true);
}

export function logVerbose(...args: Parameters<Console['log']>): void {
  if (getLogLevel() !== 'verbose') {
    return;
  }

  console.log(...args);
  logToOutputChannel(args.join(' '));
}
