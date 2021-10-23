import * as vscode from 'vscode';
import ClipsRepl, { commandEnded } from './ClipsRepl';
import { RedirectData } from './logic';

const docNames = ['facts', 'agenda'] as const;
type DocName = typeof docNames[number];

class ClipsDoc {
  content: string = '';
  private doc?: vscode.TextDocument;

  constructor(
    private name: DocName,
    private onDidChangeEmitter: vscode.EventEmitter<vscode.Uri>,
    private getRepl: () => ClipsRepl | undefined
  ) {}

  clear = () => (this.content = '');

  getUriString = () => `clips:${this.name}`;
  getUri = () => vscode.Uri.parse(this.getUriString());

  isVisible = () =>
    vscode.window.visibleTextEditors.some(
      (e) => e.document.uri.toString() === this.getUriString()
    );

  updateDoc = () => {
    if (!this.isVisible()) {
      return;
    }

    const repl = this.getRepl();
    if (!repl) {
      return;
    }

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
      console.log(`DATA OUT (${this.name}): `, JSON.stringify(data));
      this.content += data;
      if (commandEnded(data)) {
        this.content = cleanDoc([this.content, prepare]);

        this.onDidChangeEmitter.fire(this.getUri());
      }
    });

    repl.writeCommand(`(${this.name})`, false, () => {
      this.content = '';
      repl.redirectWriteEmitter = emitter;
    });
  };

  async open() {
    const uri = this.getUri();
    return (this.doc = await vscode.workspace.openTextDocument(uri));
  }

  async show(options?: vscode.TextDocumentShowOptions) {
    if (!this.doc) {
      return;
    }
    return await vscode.window.showTextDocument(this.doc, options);
  }
}

export default class ClipsDocs {
  private docs: { [k in DocName]?: ClipsDoc };
  myProvider;
  private openEditors: vscode.TextEditor[];

  constructor(private repl?: ClipsRepl) {
    this.myProvider = this.createProvider();
    this.docs = {};
    this.openEditors = [];
  }

  createDoc = (name: DocName) => {
    return (this.docs[name] = new ClipsDoc(
      name,
      this.myProvider.onDidChangeEmitter,
      () => this.repl
    ));
  };

  setRepl = (repl: ClipsRepl) => {
    this.repl = repl;
  };

  private createProvider() {
    const thisObj = this;
    return new (class implements vscode.TextDocumentContentProvider {
      onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
      onDidChange = this.onDidChangeEmitter.event;
      provideTextDocumentContent(uri: vscode.Uri): string {
        const contentType = uri.path;
        if (contentType in thisObj.docs) {
          const content = thisObj.docs[contentType as DocName]?.content;
          console.log('PROVIDING: ', content);
          return content ?? '';
        }
        return '';
      }
    })();
  }

  updateDocs = () => {
    for (const docName in this.docs) {
      this.docs[docName as DocName]?.updateDoc();
    }
  };

  private async openDoc(
    name: DocName,
    options?: vscode.TextDocumentShowOptions
  ) {
    let doc = this.docs[name];
    if (!doc) {
      doc = this.createDoc(name);
    }

    await doc.open();

    const editor = await doc.show(options);

    if (editor) {
      this.openEditors.push(editor);
    }
  }

  async open() {
    await this.openDoc('facts', {
      preview: false,
      viewColumn: vscode.ViewColumn.Beside,
    });

    // Split the previous and next document horizontally
    await vscode.commands.executeCommand('workbench.action.newGroupBelow');

    await this.openDoc('agenda', { preview: false });

    // Give focus to the original group by focusing the previous one once for each editor the extension creates
    vscode.commands.executeCommand('workbench.action.focusPreviousGroup');
    vscode.commands.executeCommand('workbench.action.focusPreviousGroup');

    this.updateDocs();
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

    for (const docName in this.docs) {
      this.docs[docName as DocName]?.clear();
    }
    this.openEditors = [];
  }

  dispose() {
    this.myProvider.onDidChangeEmitter.dispose();
  }
}
