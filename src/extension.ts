// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as AsyncLock from 'async-lock';
import { getCoreNodeModule } from './util';

import { IPty } from 'node-pty';
const nodepty: typeof import('node-pty') = getCoreNodeModule('node-pty');

type RedirectData = [string, (data: string) => string];

const state: {
  clips?: IPty;
  started?: boolean;
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
  openEditors?: vscode.TextEditor[];
  lastCmd?: string;
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
      const fullCmd = cmd + '\r\n';
      state.lastCmd = fullCmd;
      return state.clips?.write(fullCmd);
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

  const closePty = () => {
    console.log('CLOSING PTY');

    // Make sure that the shell is actually closed
    state.clips?.kill();

    state.started = false;

    vscode.commands.executeCommand(
      'setContext',
      'clips-ide.terminalOpen',
      false
    );

    // The 'hide' method is deprecated, but it seems to be the only reasonable working solution (currently)
    // reference: https://github.com/microsoft/vscode/issues/21617#issuecomment-283365406
    state.openEditors?.forEach((e) => {
      if (e.hide) {
        return e.hide();
      }
      // Added an error message in case the method ever gets removed
      return vscode.window.showErrorMessage(
        'The window hiding functionality seems to be missing. This probably has to do with a VSCode update. Please report the issue to the developer.'
      );
    });

    state.docs = {};
    delete state.openEditors;
  };

  // If there is a prompt inside the data, we can assume that the command output ended
  const commandEnded = (data: string) => data.includes('CLIPS>');

  const updateDoc = (name: keyof typeof state.docs) => {
    // Removes last two lines (Summary and prompt)
    const cleanDoc = ([data, prepare]: RedirectData): string => {
      if (data.startsWith('CLIPS>')) {
        return '';
      } else {
        const summaryIndex = data.lastIndexOf('For a total of');
        return prepare(data.slice(0, summaryIndex).trimEnd());
      }
    };

    const emitter = new vscode.EventEmitter<RedirectData>();
    emitter.event(([data, prepare]) => {
      console.log(`DATA OUT (${name}): `, JSON.stringify(data));
      state.docs[name] += data;
      if (commandEnded(data)) {
        state.docs[name] = cleanDoc([state.docs[name] ?? '', prepare]);

        myProvider.onDidChangeEmitter.fire(vscode.Uri.parse(`clips:${name}`));
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

  const colorRed = (data: string) => '\x1b[31m' + data + '\x1b[0m';

  const clipsPty: vscode.Pseudoterminal = {
    onDidWrite: writeEmitter.event,
    onDidClose: closeEmitter.event,
    open: () => {
      const versionCheckEmitter = new vscode.EventEmitter<RedirectData>();

      versionCheckEmitter.event(([data, prepare]) => {
        /**
         * It looks like CLIPS considers '6.40' to be equivalent to '6.4', in which case '6.40 > 6.4' would be false.
         * But string comparison seems to work exactly like CLIPS version number comparison except for that.
         * '6.40 > 6.4' would be true, so we remove trailing zeros in the regex just to make sure it works for all cases.
         */
        const version = /\((.*?)0*\s/.exec(data)?.[1];
        const minVersion = '6.4';

        console.log('VERSION: ', JSON.stringify(version));

        // If the CLIPS version is >= 6.40, assume that SIGINT works
        state.sigintWorks = version !== undefined && version >= minVersion;

        console.log('SIGINT WORKS: ', state.sigintWorks);

        // Sends the data to the original emitter
        writeEmitter.fire(prepare(data));
      });

      // Used to take the first line, where the version is printed
      state.redirectWriteEmitter = versionCheckEmitter;

      state.lock = new AsyncLock();
      state.clips = nodepty.spawn('clips', [], {});

      // Idea from: https://github.com/microsoft/node-pty/issues/74#issuecomment-295520624
      setTimeout(() => (state.started = true), 500);

      state.clips.onData((data) => {
        let sData: string = data.toString();

        console.log('DATA OUT RAW: ', JSON.stringify(sData));

        // Input is echoed in output when using node-pty, so it needs to be removed
        // https://github.com/microsoft/node-pty/issues/78
        if (state.lastCmd && sData.startsWith(state.lastCmd)) {
          sData = sData.slice(state.lastCmd.length);
        }

        // It seems like node-pty adds an extra line break to the output
        if (sData.startsWith('\r\n')) {
          sData = sData.slice(2);
        }

        let prepare = (data: string) => data;

        // If the data starts with '\r\n[' we can probably assume that it is an error
        // (because CLIPS outputs errors with lines starting with error codes like '[ERRORCODE]' and a line break before it)
        if (sData.startsWith('\r\n[')) {
          prepare = (data) => {
            const lineBreakIndex = data.indexOf('\n', 3);
            if (lineBreakIndex >= 0) {
              return (
                colorRed(data.slice(0, lineBreakIndex + 1)) +
                data.slice(lineBreakIndex + 1)
              );
            }
            return colorRed(data);
          };
        }

        console.log('DATA OUT: ', JSON.stringify(sData));

        const commandHasEnded = commandEnded(sData);

        if (state.redirectWriteEmitter) {
          state.redirectWriteEmitter.fire([sData, prepare]);
          if (commandHasEnded) {
            delete state.redirectWriteEmitter;
            state.lockDone?.();
          }
        } else {
          const res = prepare(sData);
          console.log('RES: ', JSON.stringify(res));

          writeEmitter.fire(res);

          if (commandHasEnded) {
            state.lockDone?.();
            updateDocs();
          }
        }
      });
      state.clips.onExit(() => {
        if (!state.started) {
          vscode.window.showErrorMessage(
            'Fatal error. Check if CLIPS is installed.'
          );
        }

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

  const terminalOptions: vscode.ExtensionTerminalOptions = {
    name: 'CLIPS',
    pty: clipsPty,
  };

  const termD = vscode.window.registerTerminalProfileProvider(
    'clips-ide.clips-terminal',
    {
      provideTerminalProfile: () => new vscode.TerminalProfile(terminalOptions),
    }
  );

  const checkTerminal = (t: vscode.Terminal | undefined) => {
    if (t && terminalOptions === t.creationOptions) {
      state.terminal = t;
    }
  };

  // When opening the CLIPS terminal via profile, this is the only way to retrieve the terminal object
  vscode.window.onDidOpenTerminal(checkTerminal);

  // If multiple CLIPS terminals are open, we should only use the last active one
  vscode.window.onDidChangeActiveTerminal(checkTerminal);

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  const mainD = vscode.commands.registerCommand(
    'clips-ide.open-clips-env',
    async () => {
      const factsUri = vscode.Uri.parse('clips:facts');
      const agendaUri = vscode.Uri.parse('clips:agenda');

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

      state.openEditors = [factsEditor, agendaEditor];

      const terminal = vscode.window.createTerminal(terminalOptions);

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

  context.subscriptions.push(termD, mainD, docD, loadD, loadCD);
}

// this method is called when your extension is deactivated
export function deactivate() {
  state.clips?.kill();
}
