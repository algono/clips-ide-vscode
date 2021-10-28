import * as vscode from 'vscode';
import ClipsRepl from './ClipsRepl';
import { RedirectData, commandEnded, prompt } from './logic';
import * as logger from './Logger';

const docNames = ['facts', 'agenda', 'instances'] as const;
type DocName = typeof docNames[number];

const uriScheme = 'clips';

class ClipsDoc {
  content: string = '';
  private doc?: vscode.TextDocument;
  private needsUpdate: boolean = true;

  constructor(
    private name: DocName,
    private onDidChangeEmitter: vscode.EventEmitter<vscode.Uri>,
    private getRepl: () => ClipsRepl | undefined
  ) {}

  clear = () => (this.content = '');

  getUriString = () => `${uriScheme}:${this.name}`;
  getUri = () => vscode.Uri.parse(this.getUriString());

  isVisible = () =>
    vscode.window.visibleTextEditors.some(
      (e) => e.document.uri.toString() === this.getUriString()
    );

  update = (onlyIfNeeded: boolean = false) => {
    if (onlyIfNeeded && !this.needsUpdate) {
      return;
    }

    if (!this.isVisible()) {
      this.needsUpdate = true;
      return;
    }

    const repl = this.getRepl();
    if (!repl) {
      this.needsUpdate = true;
      return;
    }

    this.needsUpdate = false;

    // Removes last two lines (Summary and prompt)
    const cleanDoc = ([data, prepare]: RedirectData): string => {
      if (data.startsWith(prompt)) {
        return '';
      } else {
        const summaryIndex = data.lastIndexOf('For a total of');
        return prepare(data.slice(0, summaryIndex).trimEnd());
      }
    };

    const emitter = new vscode.EventEmitter<RedirectData>();
    emitter.event(([data, prepare]) => {
      logger.logVerbose(`DATA OUT (${this.name}): `, JSON.stringify(data));
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
  private readonly updateOnVisibleD: vscode.Disposable;

  constructor(private repl?: ClipsRepl) {
    this.myProvider = this.createProvider();
    this.docs = {};

    // Each time there's an update in the visible text editors
    this.updateOnVisibleD = vscode.window.onDidChangeVisibleTextEditors(
      (editors) => {
        editors.forEach((editor) => {
          // if there's a CLIPS editor
          if (editor.document.uri.scheme === uriScheme) {
            const name = editor.document.uri.path;
            // and it is within the created docs
            if (name in this.docs) {
              // check if it needs to be updated
              this.docs[name as DocName]?.update(true);
            }
          }
        });
      }
    );
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
          logger.logVerbose('PROVIDING: ', content);
          return content ?? '';
        }
        return '';
      }
    })();
  }

  updateDocs = () => {
    for (const docName in this.docs) {
      this.docs[docName as DocName]?.update();
    }
  };

  private async openDoc(
    name: DocName,
    options: vscode.TextDocumentShowOptions = { preview: false }
  ) {
    let doc = this.docs[name];
    if (!doc) {
      doc = this.createDoc(name);
    }

    await doc.open();

    return await doc.show(options);
  }

  async open() {
    const views = vscode.workspace.getConfiguration(
      'clips.defaultEnvironmentViews'
    );

    let shown = 0;
    for (const name of docNames) {
      const show = views.get<boolean>(name);
      if (show) {
        if (shown === 0) {
          await this.openDoc(name, {
            preview: false,
            viewColumn: vscode.ViewColumn.Beside,
          });
        } else {
          // Split the previous and next document horizontally
          await vscode.commands.executeCommand(
            'workbench.action.newGroupBelow'
          );
          await this.openDoc(name);
        }
        shown++;
      }
    }

    // Give focus to the original group by focusing the previous one once for each editor the extension creates
    for (let i = 0; i < shown; i++) {
      vscode.commands.executeCommand('workbench.action.focusPreviousGroup');
    }
  }

  close() {
    // The 'hide' method is deprecated, but it seems to be the only reasonable working solution (currently)
    // reference: https://github.com/microsoft/vscode/issues/21617#issuecomment-283365406

    if (vscode.window.visibleTextEditors.length > 0) {
      const firstEditor = vscode.window.visibleTextEditors[0];

      if (firstEditor.hide === undefined) {
        // Error message in case the method ever gets removed
        vscode.window.showErrorMessage(
          'The window hiding functionality seems to be missing. This probably has to do with a VSCode update. Please report the issue to the developer.'
        );
      } else {
        const closeClipsEditor = (e: vscode.TextEditor[]) => {
          return e.some((e) => {
            // If one of our CLIPS editors is visible, close it
            if (e.document.uri.scheme === uriScheme) {
              e.hide();
              return true;
            }
            return false;
          });
        };

        const anEditorWasClosed = closeClipsEditor(
          vscode.window.visibleTextEditors
        );

        // This allows for CLIPS editors to be closed if they are not visible at first
        // but they are after another editor was closed
        // Sadly, if no CLIPS editors are visible, none will be closed.
        // This seems to be a VSCode limitation, which might be solved in the future
        // reference: https://github.com/microsoft/vscode/issues/15178

        if (anEditorWasClosed) {
          const closeD = vscode.window.onDidChangeVisibleTextEditors((e) => {
            if (!closeClipsEditor(e)) {
              closeD.dispose();
            }
          });
        }
      }
    }

    for (const docName in this.docs) {
      this.docs[docName as DocName]?.clear();
    }
  }

  dispose() {
    this.myProvider.onDidChangeEmitter.dispose();
    this.updateOnVisibleD.dispose();
  }

  registerOpenCommands() {
    const disposables: vscode.Disposable[] = [];
    for (const name of docNames) {
      disposables.push(
        vscode.commands.registerCommand(
          'clips-ide.open-doc-' + name,
          async () => {
            await this.openDoc(name, {
              preview: false,
              viewColumn: vscode.ViewColumn.Beside,
            });
          }
        )
      );
    }
    return disposables;
  }
}
