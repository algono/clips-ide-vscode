import * as vscode from 'vscode';
import * as AsyncLock from 'async-lock';

import { getCoreNodeModule } from './util';
import { IPty } from 'node-pty';
const nodepty: typeof import('node-pty') = getCoreNodeModule('node-pty');

import { RedirectData } from './logic';
import HandlerInput from './HandlerInput';
import VersionChecker from './VersionChecker';

// If there is a prompt inside the data, we can assume that the command output ended
export function commandEnded(data: string) {
  return data.includes('CLIPS>');
}

function colorRed(data: string) {
  return '\x1b[31m' + data + '\x1b[0m';
}

export default class ClipsRepl {
  private clips?: IPty;
  private starting?: boolean;
  private lock?: AsyncLock;
  private terminalHasLock?: boolean;
  private lockDone?: Parameters<
    Parameters<InstanceType<typeof AsyncLock>['acquire']>[1]
  >[0];
  private writeEmitter: vscode.EventEmitter<string>;
  redirectWriteEmitter?: vscode.EventEmitter<RedirectData>;

  private terminal?: vscode.Terminal;
  private lastCmd?: string;

  private readonly ptyDef: vscode.Pseudoterminal;
  readonly terminalOptions;

  private readonly commandEmitter: vscode.EventEmitter<void>;
  private readonly closeEmitter: vscode.EventEmitter<void>;

  private onOpenDisposable?: vscode.Disposable;

  constructor() {
    this.writeEmitter = new vscode.EventEmitter<string>();

    this.commandEmitter = new vscode.EventEmitter<void>();
    this.closeEmitter = new vscode.EventEmitter<void>();

    const ptyCloseEmitter = new vscode.EventEmitter<void>();

    const handlerInput = new HandlerInput(this.writeEmitter, this.writeCommand);

    const sigintWorksEmitter = new vscode.EventEmitter<boolean>();
    sigintWorksEmitter.event((sigintWorks) => {
      handlerInput.sigintWorks = sigintWorks;
    });

    this.ptyDef = {
      onDidWrite: this.writeEmitter.event,
      onDidClose: ptyCloseEmitter.event,
      open: () => {
        const versionCheckEmitter = VersionChecker.setup(
          this.writeEmitter,
          sigintWorksEmitter
        );

        // Used to take the first line, where the version is printed
        this.redirectWriteEmitter = versionCheckEmitter;

        this.starting = true;

        this.clips = nodepty.spawn('clips', [], {});

        // Idea from: https://github.com/microsoft/node-pty/issues/74#issuecomment-295520624
        setTimeout(() => (this.starting = false), 500);

        this.clips.onData((data) => {
          let sData: string = data.toString();

          console.log('DATA OUT RAW: ', JSON.stringify(sData));

          // Input is echoed in output when using node-pty, so it needs to be removed
          // https://github.com/microsoft/node-pty/issues/78
          if (this.lastCmd && sData.startsWith(this.lastCmd)) {
            sData = sData.slice(this.lastCmd.length);
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

          if (this.redirectWriteEmitter) {
            this.redirectWriteEmitter.fire([sData, prepare]);
            if (commandHasEnded) {
              this.redirectWriteEmitter.dispose();
              delete this.redirectWriteEmitter;
              this.lockDone?.();
            }
          } else {
            const res = prepare(sData);
            console.log('RES: ', JSON.stringify(res));

            this.writeEmitter.fire(res);

            if (commandHasEnded) {
              this.lockDone?.();
              this.commandEmitter.fire();
            }
          }
        });
        this.clips.onExit(() => {
          if (this.starting) {
            vscode.window.showErrorMessage(
              'Fatal error. Check if CLIPS is installed.'
            );
          }

          return ptyCloseEmitter.fire();
        });
        vscode.commands.executeCommand(
          'setContext',
          'clips-ide.terminalOpen',
          true
        );
      },
      close: this.close,
      handleInput: handlerInput.handle,
    };

    this.terminalOptions = {
      name: 'CLIPS',
      pty: this.ptyDef,
    };

    // Create the CLIPS lock and acquire it on terminal open, as commands cannot be sent until the REPL is ready
    this.onOpenDisposable = vscode.window.onDidOpenTerminal((t) => {
      if (this.equalsTerminal(t)) {
        this.lock = new AsyncLock();
        this.lock?.acquire('clips', (done) => (this.lockDone = done));
      }
    });
  }

  writeCommand = (cmd: string, isTerminal: boolean, before?: () => any) => {
    const write = () => {
      before?.();
      const fullCmd = cmd + '\r\n';
      this.lastCmd = fullCmd;
      return this.clips?.write(fullCmd);
    };

    // If the terminal already had the lock, bypass it
    // (this should allow for commands which ask for user input more than once to work)

    // (NOTE: Doing this assumes that no processes other than the terminal need multiple user inputs)
    // (if that ceased to be the case, an id system for processes should need to be implemented)
    if (isTerminal && this.terminalHasLock) {
      return write();
    }

    return this.lock?.acquire('clips', (done) => {
      this.lockDone = done;
      this.terminalHasLock = isTerminal;
      write();
    });
  };

  sendCommand(cmd: string) {
    this.terminal?.sendText(`(${cmd})`, false);
    this.terminal?.sendText('\r', false);
  }

  close = () => {
    console.log('CLOSING PTY');

    // Make sure that the shell is actually closed
    this.clips?.kill();
    this.lockDone?.();

    vscode.commands.executeCommand(
      'setContext',
      'clips-ide.terminalOpen',
      false
    );

    this.closeEmitter.fire();

    // Dispose event emitters and listeners
    this.writeEmitter.dispose();
    this.redirectWriteEmitter?.dispose();
    this.commandEmitter.dispose();
    this.closeEmitter.dispose();
    this.onOpenDisposable?.dispose();
  };

  createTerminal(): vscode.Terminal {
    return (this.terminal = vscode.window.createTerminal(this.terminalOptions));
  }

  hasTerminal() {
    return this.terminal !== undefined;
  }

  equalsTerminal(other: vscode.Terminal) {
    return this.terminalOptions === other.creationOptions;
  }

  updateTerminal = (t: vscode.Terminal | undefined) => {
    if (t && this.equalsTerminal(t)) {
      this.terminal = t;
      return true;
    }
    return false;
  };

  onCommand = (...args: Parameters<vscode.Event<void>>) =>
    this.commandEmitter.event(...args);
  onClose = (...args: Parameters<vscode.Event<void>>) =>
    this.closeEmitter.event(...args);
}
