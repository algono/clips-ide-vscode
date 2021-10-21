// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import ClipsRepl from './ClipsRepl';

const state: {
  clips?: ClipsRepl;
} = {};

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  state.clips = new ClipsRepl();

  const docD = vscode.workspace.registerTextDocumentContentProvider(
    'clips',
    state.clips.docs.myProvider
  );

  const terminalOptions = state.clips.getTerminalOptions();

  const termD = vscode.window.registerTerminalProfileProvider(
    'clips-ide.clips-terminal',
    {
      provideTerminalProfile: () => new vscode.TerminalProfile(terminalOptions),
    }
  );

  // When opening the CLIPS terminal via profile, this is the only way to retrieve the terminal object
  vscode.window.onDidOpenTerminal(state.clips.updateTerminal);

  // If multiple CLIPS terminals are open, we should only use the last active one
  vscode.window.onDidChangeActiveTerminal(state.clips.updateTerminal);

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  const mainD = vscode.commands.registerCommand(
    'clips-ide.open-clips-env',
    async () => {
      state.clips?.docs.open();

      const terminal = state.clips?.createTerminal();

      terminal?.show();

      if (terminal) {
        context.subscriptions.push(terminal);
      }
    }
  );

  const loadD = vscode.commands.registerCommand(
    'clips-ide.load-file',
    async () => {
      const files = await vscode.window.showOpenDialog();
      if (!state.clips?.hasTerminal()) {
        vscode.window.showErrorMessage(
          'Error: The CLIPS terminal is not open.'
        );
        return;
      }
      files?.forEach((file) => {
        state.clips?.sendCommand(`load ${file.fsPath}`);
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
      if (!state.clips?.hasTerminal()) {
        vscode.window.showErrorMessage(
          'Error: The CLIPS terminal is not open.'
        );
        return;
      }
      state.clips?.sendCommand(`load ${filePath}`);
    }
  );

  // VSCode commands for executing CLIPS commands in terminal
  ['run', 'reset', 'clear'].forEach((cmd) => {
    const cmdD = vscode.commands.registerCommand('clips-ide.cmd-' + cmd, () => {
      if (!state.clips?.hasTerminal()) {
        vscode.window.showErrorMessage(
          'Error: The CLIPS terminal is not open.'
        );
        return;
      }
      return state.clips?.sendCommand(cmd);
    });
    context.subscriptions.push(cmdD);
  });

  context.subscriptions.push(termD, mainD, docD, loadD, loadCD);
}

// this method is called when your extension is deactivated
export function deactivate() {
  state.clips?.closePty();
}
