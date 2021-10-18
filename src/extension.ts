// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';

import * as AsyncLock from 'async-lock';

type RedirectData = [string, (data: string) => string];

const state: {
  clips?: ChildProcessWithoutNullStreams;
  lock?: AsyncLock;
  terminalHasLock?: boolean;
  lockDone?: Parameters<
    Parameters<InstanceType<typeof AsyncLock>['acquire']>[1]
  >[0];
  ptyWriteEmitter?: vscode.EventEmitter<string>;
  redirectWriteEmitter?: vscode.EventEmitter<RedirectData>;
  docs: {
    facts?: string;
    agenda?: string;
  };
  terminal?: vscode.Terminal;
} = { docs: {} };

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  const writeEmitter = new vscode.EventEmitter<string>();
  const closeEmitter = new vscode.EventEmitter<void>();

  state.ptyWriteEmitter = writeEmitter;

  const writeCommand = (
    cmd: string,
    isTerminal: boolean,
    before?: () => any
  ) => {
    const write = () => {
      before?.();
      return state.clips?.stdin.write(cmd + '\r\n');
    };

    // If the terminal already had the lock, bypass it
    // (this should allow for commands which ask for user input more than once to work)

    // (NOTE: Doing this assumes that no processes other than the terminal need multiple user inputs)
    // (if that ceased to be the case, an id system for processes should need to be implemented)
    if (isTerminal && state.terminalHasLock) {
      return write();
    }

    return state.lock?.acquire('clips', (done) => {
      state.lockDone = done;
      state.terminalHasLock = isTerminal;
      write();
    });
  };

  let line = '',
    pos = 0;
  const handleInput: (data: string) => void = (data) => {
    console.log('LINE:', line);
    switch (data) {
      case '\r':
        writeEmitter.fire('\r\n');
        writeCommand(line, true);
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

  const docD = vscode.workspace.registerTextDocumentContentProvider(
    'clips',
    myProvider
  );

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  const mainD = vscode.commands.registerCommand(
    'clips-ide.open-clips-env',
    async () => {
      // The code you place here will be executed every time your command is executed

      // If there is a prompt inside the data, we can assume that the command output ended
      const commandEnded = (data: string) => data.includes('CLIPS>');

      const factsUri = vscode.Uri.parse('clips:facts');
      const agendaUri = vscode.Uri.parse('clips:agenda');

      const updateDoc = (name: keyof typeof state.docs) => {
        // Removes last two lines (Summary and prompt)
        const cleanDoc = ([data, cleanLineBreaks]: RedirectData): string => {
          if (data.startsWith('CLIPS>')) {
            return '';
          } else {
            const summaryIndex = data.lastIndexOf('For a total of');
            return cleanLineBreaks(data.slice(0, summaryIndex).trimEnd());
          }
        };

        const emitter = new vscode.EventEmitter<RedirectData>();
        emitter.event(([data, cleanLineBreaks]) => {
          console.log(`DATA (${name}): ` + data);
          state.docs[name] += data;
          if (commandEnded(data)) {
            state.docs[name] = cleanDoc([
              state.docs[name] ?? '',
              cleanLineBreaks,
            ]);

            myProvider.onDidChangeEmitter.fire(
              vscode.Uri.parse(`clips:${name}`)
            );
          }
        });

        writeCommand(`(${name})`, false, () => {
          state.docs[name] = '';
          state.redirectWriteEmitter = emitter;
        });
      };

      const updateDocs = () => {
        updateDoc('facts');
        updateDoc('agenda');
      };

      updateDocs();

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

      const clipsPty: vscode.Pseudoterminal = {
        onDidWrite: writeEmitter.event,
        onDidClose: closeEmitter.event,
        open: () => {
          state.lock = new AsyncLock();
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

            const cleanLineBreaks = (data: string) =>
              data.replace(/\n/g, '\r\n');

            const commandHasEnded = commandEnded(sData);

            if (state.redirectWriteEmitter) {
              state.redirectWriteEmitter.fire([sData, cleanLineBreaks]);
              if (commandHasEnded) {
                delete state.redirectWriteEmitter;
                state.lockDone?.();
              }
            } else {
              const res = cleanLineBreaks(sData);
              console.log('RES: ', JSON.stringify(res));

              writeEmitter.fire(res);

              if (commandHasEnded) {
                state.lockDone?.();
                updateDocs();
              }
            }
          });
          state.clips.on('exit', () => closeEmitter.fire());
        },
        close: () => {},
        handleInput,
      };

      const terminal = vscode.window.createTerminal({
        name: 'CLIPS',
        pty: clipsPty,
      });

      state.terminal = terminal;

      terminal.show();

      context.subscriptions.push(terminal);
    }
  );

  const loadD = vscode.commands.registerCommand(
    'clips-ide.load-file',
    async () => {
      const files = await vscode.window.showOpenDialog();
      if (!state.terminal) {
        vscode.window.showErrorMessage(
          'Error: The CLIPS terminal is not open.'
        );
        return;
      }
      files?.forEach((file) => {
        state.terminal?.sendText(`(load ${file.fsPath})`);
        state.terminal?.sendText('\r');
      });
    }
  );

  const loadCD = vscode.commands.registerCommand(
    'clips-ide.load-current-file',
    async () => {
      const filePath = vscode.window.activeTextEditor?.document.fileName;
      if (!filePath) {
        vscode.window.showErrorMessage(
          'Error: There is no currently open file.'
        );
        return;
      }
      if (!state.terminal) {
        vscode.window.showErrorMessage(
          'Error: The CLIPS terminal is not open.'
        );
        return;
      }
      state.terminal?.sendText(`(load ${filePath})`);
      state.terminal?.sendText('\r');
    }
  );

  context.subscriptions.push(mainD, docD, loadD, loadCD);
}

// this method is called when your extension is deactivated
export function deactivate() {
  state.clips?.kill();
}
