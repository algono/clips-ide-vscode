import * as vscode from 'vscode';
import ClipsRepl, { commandEnded } from './ClipsRepl';
import { RedirectData } from './logic';

const docNames = ['facts', 'agenda'] as const;
type DocNames = typeof docNames[number];

class ClipsDoc {
  content: string = '';

  constructor(
    private name: DocNames,
    private onDidChangeEmitter: vscode.EventEmitter<vscode.Uri>,
    private getRepl: () => ClipsRepl | undefined
  ) {}

  clear = () => (this.content = '');

  getUri = () => `clips:${this.name}`;

  isVisible = () => vscode.window.visibleTextEditors.some(
    (e) => e.document.uri.toString() === this.getUri()
  );

  updateDoc = () => {
    if (!this.isVisible()) {
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

        this.onDidChangeEmitter.fire(vscode.Uri.parse(this.getUri()));
      }
    });

    const repl = this.getRepl();

    repl?.writeCommand(`(${this.name})`, false, () => {
      this.content = '';
      if (repl) {
        repl.redirectWriteEmitter = emitter;
      }
    });
  };
}

export default class ClipsDocs {
  private docs: { [k in DocNames]: ClipsDoc };
  myProvider;
  private openEditors?: vscode.TextEditor[];

  constructor(private repl?: ClipsRepl) {
    this.myProvider = this.createProvider();

    const docs: Partial<typeof this.docs> = {};
    docNames.forEach((name) => {
      docs[name] = new ClipsDoc(
        name,
        this.myProvider.onDidChangeEmitter,
        () => this.repl
      );
    });
    // TypeScript can't infer that the previous forEach filled all the required properties,
    // so we assure the type system that it did
    this.docs = docs as typeof this.docs;
  }

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
          const content = thisObj.docs[contentType as DocNames].content;
          console.log('PROVIDING: ', content);
          return content ?? '';
        }
        return '';
      }
    })();
  }

  updateDocs = () => {
    for (const docName in this.docs) {
      this.docs[docName as DocNames].updateDoc();
    }
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

    for (const docName in this.docs) {
      this.docs[docName as DocNames].clear();
    }
    delete this.openEditors;
  }
}
