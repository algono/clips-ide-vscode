// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import ClipsDocs from './ClipsDocs';
import ClipsRepl from './ClipsRepl';

const state: {
  clips?: ClipsRepl;
  docs?: ClipsDocs;
  instances: ClipsRepl[];
} = { instances: [] };

function createRepl() {
  const clips = new ClipsRepl();

  state.clips = clips;
  state.instances.push(clips);

  clips.onCommand(() => clips === state.clips && state.docs?.updateDocs());
  clips.onClose(() => {
    // If the REPL being closed is the active one, close the docs
    clips === state.clips && state.docs?.close();
    
    // Remove REPL from instances list if it is being closed
    state.instances = state.instances.filter((i) => i !== state.clips);
  });

  return clips;
}

function initDocs() {
  state.docs = new ClipsDocs(state.clips);
  return state.docs;
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  const docs = initDocs();

  const docD = vscode.workspace.registerTextDocumentContentProvider(
    'clips',
    docs.myProvider
  );

  const termD = vscode.window.registerTerminalProfileProvider(
    'clips-ide.clips-terminal',
    {
      provideTerminalProfile: () => {
        const clips = createRepl();
        return new vscode.TerminalProfile(clips.terminalOptions);
      },
    }
  );

  const updateActiveRepl = (t: vscode.Terminal | undefined) => {
    return state.instances.some((c) => {
      if (c.updateTerminal(t)) {
        state.clips = c;
        if (state.docs) {
          state.docs.setRepl(c);
          state.docs.updateDocs();
        }
        return true;
      }
      return false;
    });
  };

  // If multiple CLIPS terminals are open, we should only use the last active one
  vscode.window.onDidChangeActiveTerminal(updateActiveRepl);

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  const mainD = vscode.commands.registerCommand(
    'clips-ide.open-clips-env',
    async () => {
      await state.docs?.open();

      const clips = createRepl();
      const terminal = clips.createTerminal();

      terminal.show();

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
  state.instances.forEach((c) => c.closePty());
}
