// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import ClipsViews from './ClipsViews';
import ClipsRepl from './ClipsRepl';
import { fixFsPath } from './util';

const state: {
  clips?: ClipsRepl;
  views?: ClipsViews;
  instances: ClipsRepl[];
} = { instances: [] };

function createRepl() {
  const clips = new ClipsRepl();

  state.clips = clips;
  state.instances.push(clips);

  clips.onCommand(() => clips === state.clips && state.views?.updateViews());
  clips.onClose(() => {
    // Remove REPL from instances list if it is being closed
    state.instances = state.instances.filter((i) => i !== clips);

    // and from the active variable
    if (clips === state.clips) {
      state.clips = undefined;
    }

    // If the REPL being closed is the last one, close the views and update the context
    if (state.instances.length === 0) {
      state.views?.close();
      vscode.commands.executeCommand(
        'setContext',
        'clips-ide.terminalOpen',
        false
      );
    }
  });

  return clips;
}

function initViews() {
  state.views = new ClipsViews(state.clips);
  return state.views;
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  const views = initViews();

  const docD = vscode.workspace.registerTextDocumentContentProvider(
    'clips',
    views.myProvider
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
        if (state.views) {
          state.views.setRepl(c);
          state.views.updateViews();
        }
        return true;
      }
      return false;
    });
  };

  // If multiple CLIPS terminals are open, we should only use the last active one
  const activeD = vscode.window.onDidChangeActiveTerminal(updateActiveRepl);

  const openTerminal = () => {
    const clips = createRepl();
    const terminal = clips.createTerminal();

    terminal.show();

    if (terminal) {
      context.subscriptions.push(terminal);
    }
  };

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  const mainD = vscode.commands.registerCommand(
    'clips-ide.open-clips-env',
    async () => {
      await state.views?.open();
      openTerminal();
    }
  );

  const termCD = vscode.commands.registerCommand(
    'clips-ide.open-terminal',
    openTerminal
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
        state.clips?.sendCommand(`load "${fixFsPath(file.fsPath)}"`);
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
      state.clips?.sendCommand(`load "${fixFsPath(filePath)}"`);
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

  const viewsD = views.registerOpenCommands();

  const exitD = vscode.commands.registerCommand('clips-ide.exit', async () => {
    return state.clips?.close();
  });

  context.subscriptions.push(
    termD,
    mainD,
    docD,
    loadD,
    loadCD,
    activeD,
    views,
    termCD,
    ...viewsD,
    exitD,
    {
      dispose: () => state.clips?.close(),
    }
  );
}

// this method is called when your extension is deactivated
export function deactivate() {
  state.instances.forEach((c) => c.close());
}
