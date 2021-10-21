import * as vscode from 'vscode';
import ClipsRepl, { commandEnded } from './ClipsRepl';
import { RedirectData } from './logic';

interface Docs {
  facts?: string;
  agenda?: string;
}

export default class ClipsDocs {
  private docs: Docs = {};
  myProvider;
  private openEditors?: vscode.TextEditor[];

  constructor(private repl: ClipsRepl) {
    this.myProvider = this.createProvider();
  }

  private createProvider() {
    const thisObj = this;
    return new (class implements vscode.TextDocumentContentProvider {
      onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
      onDidChange = this.onDidChangeEmitter.event;
      provideTextDocumentContent(uri: vscode.Uri): string {
        const contentType = uri.path;
        if (contentType in thisObj.docs) {
          const content = thisObj.docs[contentType as keyof Docs];
          console.log('PROVIDING: ', content);
          return content ?? '';
        }
        return '';
      }
    })();
  }

  updateDoc = (name: keyof Docs) => {
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
      this.docs[name] += data;
      if (commandEnded(data)) {
        this.docs[name] = cleanDoc([this.docs[name] ?? '', prepare]);

        this.myProvider.onDidChangeEmitter.fire(vscode.Uri.parse(`clips:${name}`));
      }
    });

    this.repl.writeCommand(`(${name})`, false, () => {
      this.docs[name] = '';
      this.repl.redirectWriteEmitter = emitter;
    });
  };

  updateDocs = () => {
    this.updateDoc('facts');
    this.updateDoc('agenda');
  };

  async open() {
    const factsUri = vscode.Uri.parse('clips:facts');
    const agendaUri = vscode.Uri.parse('clips:agenda');

    this.updateDocs();

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

    this.openEditors = [factsEditor, agendaEditor];
  }

  close() {
    // The 'hide' method is deprecated, but it seems to be the only reasonable working solution (currently)
    // reference: https://github.com/microsoft/vscode/issues/21617#issuecomment-283365406
    this.openEditors?.every((e) => {
      if (e.hide) {
        e.hide();
        return true;
      }
      // Added an error message in case the method ever gets removed
      vscode.window.showErrorMessage(
        'The window hiding functionality seems to be missing. This probably has to do with a VSCode update. Please report the issue to the developer.'
      );
      return false;
    });

    this.docs = {};
    delete this.openEditors;
  }
}
