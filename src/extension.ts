// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';

type RedirectData = [string, (data: string) => string];

const state: {
  clips?: ChildProcessWithoutNullStreams;
  ptyWriteEmitter?: vscode.EventEmitter<string>;
  redirectWriteEmitter?: vscode.EventEmitter<RedirectData>;
  docs: {
    facts?: string;
    agenda?: string;
  };
} = { docs: {} };

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  const writeEmitter = new vscode.EventEmitter<string>();
  const closeEmitter = new vscode.EventEmitter<void>();

  state.ptyWriteEmitter = writeEmitter;

  let line = '',
    pos = 0;
  const handleInput: (data: string) => void = (data) => {
    console.log('LINE:', line);
    switch (data) {
      case '\r':
        writeEmitter.fire('\r\n');
        state.clips?.stdin.write(line + '\r\n');
        line = '';
        pos = 0;
        return;
      case '\x7f': // Backspace
        if (pos === 0) {
          return;
        }
        line = line.slice(0, pos - 1) + line.slice(pos);
        pos--;
        // Move cursor backward
        writeEmitter.fire('\x1b[D');
        // Delete character
        writeEmitter.fire('\x1b[P');
        return;
      case '\x1b[A': // up arrow
      case '\x1b[B': // down arrow
        // CLIPS does not seem to support command history with up and down arrows
        // so we just ignore them
        return;
      case '\x1b[D': // left arrow
        if (pos === 0) {
          return;
        }
        pos--;
        break;
      case '\x1b[C': // right arrow
        if (pos >= line.length) {
          return;
        }
        pos++;
        break;
      case '\x1b[3~': // del key
        if (pos >= line.length) {
          return;
        }
        line = line.slice(0, pos) + line.slice(pos + 1);
        // Delete character
        writeEmitter.fire('\x1b[P');
        return;
      default:
        // Support for typing characters at any position other than the end
        if (pos < line.length) {
          const before = line.slice(0, pos),
            after = line.slice(pos);
          writeEmitter.fire(data + after);
          line = before + data + after;
          // Move cursor back to the original position
          writeEmitter.fire('\x1b[D'.repeat(after.length));
        } else {
          writeEmitter.fire(data);
          line += data;
        }
        pos += data.length;
        return;
    }

    writeEmitter.fire(data);
  };

  const clipsPty: vscode.Pseudoterminal = {
    onDidWrite: writeEmitter.event,
    onDidClose: closeEmitter.event,
    open: () => {
      state.clips = spawn('clips');
      state.clips.on('error', (err) => {
        vscode.window.showErrorMessage(
          'Fatal error. Check if CLIPS is installed.'
        );
        console.error('Error: ', err);
        closeEmitter.fire();
      });
      state.clips.stdout.on('data', (data) => {
        const sData: string = data.toString();

        console.log('DATA: ', JSON.stringify(sData));

        const cleanLineBreaks = (data: string) => data.replace(/\n/g, '\r\n');

        if (state.redirectWriteEmitter) {
          state.redirectWriteEmitter.fire([sData, cleanLineBreaks]);

          // If the current command ended (noticed by the presence of the prompt) and there was a redirect, delete it
          if (sData.includes('CLIPS>')) {
            delete state.redirectWriteEmitter;
          }
        } else {
          const res = cleanLineBreaks(sData);
          console.log('RES: ', JSON.stringify(res));

          writeEmitter.fire(res);
        }
      });
      state.clips.on('exit', () => closeEmitter.fire());
    },
    close: () => {},
    handleInput,
  };

  const myProvider = new (class implements vscode.TextDocumentContentProvider {
    onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this.onDidChangeEmitter.event;
    provideTextDocumentContent(uri: vscode.Uri): string {
      const contentType = uri.path;
      if (contentType in state.docs) {
        const content = state.docs[contentType as keyof typeof state.docs];
        console.log('PROVIDING: ', content);
        return content ?? '';
      }
      return '';
    }
  })();

  let docDisposable = vscode.workspace.registerTextDocumentContentProvider(
    'clips',
    myProvider
  );

  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  //console.log('Congratulations, your extension "clips-ide" is now active!');

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  let disposable = vscode.commands.registerCommand(
    'clips-ide.open-clips-env',
    async () => {
      // The code you place here will be executed every time your command is executed
      // Display a message box to the user
      //vscode.window.showInformationMessage('Hello World from CLIPS!');

      let terminal = vscode.window.createTerminal({
        name: 'CLIPS',
        pty: clipsPty,
      });

      terminal.show();

      context.subscriptions.push(terminal);

      const factsUri = vscode.Uri.parse('clips:facts');
      const agendaUri = vscode.Uri.parse('clips:agenda');

      const writeCommand = (cmd: string) =>
        state.clips?.stdin.write(cmd + '\r\n');

      setTimeout(() => {
        const factsEmitter = new vscode.EventEmitter<RedirectData>();
        factsEmitter.event(([data, cleanLineBreaks]) => {
          console.log('FACTS DATA: ' + data);
          // Removes last two lines (Summary and prompt)
          state.docs.facts = cleanLineBreaks(data.replace(/\n.*\n.*$/, ''));
          myProvider.onDidChangeEmitter.fire(factsUri);
        });
        state.redirectWriteEmitter = factsEmitter;
        writeCommand('(facts)');
      }, 500);

      setTimeout(() => {
        const agendaEmitter = new vscode.EventEmitter<RedirectData>();
        agendaEmitter.event(([data, cleanLineBreaks]) => {
          console.log('AGENDA DATA: ' + data);
          // Removes last line (prompt)
          if (data.startsWith('CLIPS>')) {
            state.docs.agenda = '';
          } else {
            state.docs.agenda = cleanLineBreaks(data.replace(/\n.*$/, ''));
          }
          myProvider.onDidChangeEmitter.fire(agendaUri);
        });
        state.redirectWriteEmitter = agendaEmitter;
        writeCommand('(agenda)');
      }, 1000);

      const factsDoc = await vscode.workspace.openTextDocument(factsUri);
      const agendaDoc = await vscode.workspace.openTextDocument(agendaUri);

      await vscode.window.showTextDocument(factsDoc, {
        preview: false,
        viewColumn: vscode.ViewColumn.Beside,
      });

      // Split the previous and next document horizontally
      await vscode.commands.executeCommand('workbench.action.newGroupBelow');

      await vscode.window.showTextDocument(agendaDoc, {
        preview: false,
      });

      // Give focus to the original group by focusing the previous one once for each editor the extension creates
      vscode.commands.executeCommand('workbench.action.focusPreviousGroup');
      vscode.commands.executeCommand('workbench.action.focusPreviousGroup');
    }
  );

  context.subscriptions.push(disposable, docDisposable);
}

// this method is called when your extension is deactivated
export function deactivate() {
  state.clips?.kill();
}
