// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as AsyncLock from 'async-lock';
import * as semver from 'semver';

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
  sigintWorks?: boolean;
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
    console.log('LINE:', JSON.stringify(line));
    console.log('DATA IN:', JSON.stringify(data));
    switch (data) {
      case '\r':
        writeEmitter.fire('\r\n');
        writeCommand(line, true);
        line = '';
        pos = 0;
        return;
      case '\x7f': // Backspace
      case '\b': // Backspace (escape code)
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
      case '\u0003': // SIGINT (Ctrl+C)
      case '\u0015': // (Ctrl+U) (used in terminals to delete line)
        if (pos === 0) {
          return;
        }
        // Move to the left 'pos' times (aka to the initial position)
        writeEmitter.fire(`\x1b[${pos}D`);
        // Delete from cursor to the end of the line
        writeEmitter.fire('\x1b[K');

        line = '';
        pos = 0;

        // If the CLIPS version supports it and it was the SIGINT signal, also send it to the shell
        if (state.sigintWorks && data === '\u0003') {
          writeCommand(data, true);
        }
        return;
      default:
        // Support for typing characters at any position other than the end
        if (pos < line.length) {
          const before = line.slice(0, pos),
            after = line.slice(pos);
          writeEmitter.fire(data + after);
          line = before + data + after;
          // Move cursor back to the original position
          writeEmitter.fire(`\x1b[${after.length}D`);
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
          console.log(`DATA OUT (${name}): `, JSON.stringify(data));
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

      const factsEditor = await vscode.window.showTextDocument(factsDoc, {
        preview: false,
        viewColumn: vscode.ViewColumn.Beside,
      });

      // Split the previous and next document horizontally
      await vscode.commands.executeCommand('workbench.action.newGroupBelow');

      const agendaEditor = await vscode.window.showTextDocument(agendaDoc, {
        preview: false,
      });

      // Give focus to the original group by focusing the previous one once for each editor the extension creates
      vscode.commands.executeCommand('workbench.action.focusPreviousGroup');
      vscode.commands.executeCommand('workbench.action.focusPreviousGroup');

      const closePty = () => {
        console.log('CLOSING PTY');

        // Make sure that the shell is actually closed
        state.clips?.kill();

        vscode.commands.executeCommand(
          'setContext',
          'clips-ide.terminalOpen',
          false
        );

        // The 'hide' method is deprecated, but it seems to be the only reasonable working solution (currently)
        // reference: https://github.com/microsoft/vscode/issues/21617#issuecomment-283365406
        [factsEditor, agendaEditor].forEach((e) => {
          if (e.hide) {
            return e.hide();
          }
          // Added an error message in case the method ever gets removed
          return vscode.window.showErrorMessage(
            'The window hiding functionality seems to be missing. This probably has to do with a VSCode update. Please report the issue to the developer.'
          );
        });

        state.docs = {};
      };

      const cleanLineBreaks = (data: string) => data.replace(/\n/g, '\r\n');

      const colorRed = (data: string) => '\x1b[31m' + data + '\x1b[0m';

      const clipsPty: vscode.Pseudoterminal = {
        onDidWrite: writeEmitter.event,
        onDidClose: closeEmitter.event,
        open: () => {
          const versionCheckEmitter = new vscode.EventEmitter<RedirectData>();

          versionCheckEmitter.event(([data, prepare]) => {
            const version = /\((.*?)\s/.exec(data)?.[1];

            console.log('VERSION: ', JSON.stringify(version));

            const semverVersion = semver.coerce(version);

            // If the CLIPS version is >= 6.40, assume that SIGINT works
            // Note: semver needs the '.0' at the end to work
            try {
              state.sigintWorks =
                semverVersion !== null && semver.gte(semverVersion, '6.40.0');
            } catch (err) {
              console.error('ERROR: ', err);
            }
            console.log('SIGINT WORKS: ', state.sigintWorks);

            // Sends the data to the original emitter
            writeEmitter.fire(prepare(data));
          });

          // Used to take the first line, where the version is printed
          state.redirectWriteEmitter = versionCheckEmitter;

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

            console.log('DATA OUT: ', JSON.stringify(sData));

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
          state.clips.stderr.on('data', (data) => {
            const sData: string = data.toString();

            console.log('DATA ERR: ', JSON.stringify(sData));

            const prepare = (data: string) => colorRed(cleanLineBreaks(data));

            if (state.redirectWriteEmitter) {
              state.redirectWriteEmitter.fire([sData, prepare]);
            } else {
              writeEmitter.fire(prepare(sData));
            }
          });
          state.clips.on('exit', () => {
            closePty();
            return closeEmitter.fire();
          });
          vscode.commands.executeCommand(
            'setContext',
            'clips-ide.terminalOpen',
            true
          );
        },
        close: closePty,
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

  const sendCommand = (cmd: string) => {
    state.terminal?.sendText(`(${cmd})`);
    state.terminal?.sendText('\r');
  };

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
        sendCommand(`load ${file.fsPath}`);
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
      sendCommand(`load ${filePath}`);
    }
  );

  // VSCode commands for executing CLIPS commands in terminal
  ['run', 'reset', 'clear'].forEach((cmd) => {
    const cmdD = vscode.commands.registerCommand('clips-ide.cmd-' + cmd, () => {
      if (!state.terminal) {
        vscode.window.showErrorMessage(
          'Error: The CLIPS terminal is not open.'
        );
        return;
      }
      return sendCommand(cmd);
    });
    context.subscriptions.push(cmdD);
  });

  context.subscriptions.push(mainD, docD, loadD, loadCD);
}

// this method is called when your extension is deactivated
export function deactivate() {
  state.clips?.kill();
}
