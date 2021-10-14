// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';

const state: {
  clips?: ChildProcessWithoutNullStreams;
  writeEmitter?: vscode.EventEmitter<string>;
} = {};

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  const writeEmitter = new vscode.EventEmitter<string>();
  const closeEmitter = new vscode.EventEmitter<void>();

  state.writeEmitter = writeEmitter;

  const handleInput: (data: string) => void = (data) => {
      switch (data) {
        case '\r':
          writeEmitter.fire('\r\n');      
          state.clips?.stdin.write(line + '\r\n');
          line = '';
          break;
        case '\x7f': // Backspace
          if (line.length === 0) {
            return;
          }
          line = line.substr(0, line.length - 1);
          // Move cursor backwards
          writeEmitter.fire('\x1b[D');
          // Delete character
          writeEmitter.fire('\x1b[P');
          return;
      }
      line += data;
      writeEmitter.fire(data);
  };

  let line = '';
  const clipsPty: vscode.Pseudoterminal = {
    onDidWrite: writeEmitter.event,
    onDidClose: closeEmitter.event,
    open: () => {
      // TODO: ADAPT CODE TO CLIPS INSTEAD OF NODE REPL
      state.clips = spawn('node', ['-i']);
      state.clips.on('error', (err) => {
        vscode.window.showErrorMessage(
          'Fatal error. Check if CLIPS is installed.'
        );
        console.error('Error: ', err);
        closeEmitter.fire();
      });
      state.clips.stdout.on('data', (res) => {
        console.log('DATA: ', res.toString());
        writeEmitter.fire('\r' + (res.toString() as string).replace('\n', '\r\n'));
      });
      state.clips.on('exit', () => closeEmitter.fire());
    },
    close: () => {},
    handleInput,
  };

  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  //console.log('Congratulations, your extension "clips-ide" is now active!');

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  let disposable = vscode.commands.registerCommand(
    'clips-ide.helloWorld',
    () => {
      // The code you place here will be executed every time your command is executed
      // Display a message box to the user
      //vscode.window.showInformationMessage('Hello World from CLIPS!');

      let terminal = vscode.window.createTerminal({
        name: 'CLIPS',
        pty: clipsPty,
      });

      terminal.show();

      context.subscriptions.push(terminal);
    }
  );

  context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() {
  state.clips?.kill();
}
