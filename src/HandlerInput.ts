import { EventEmitter } from 'vscode';
import ClipsRepl from './ClipsRepl';
import * as logger from './Logger';
import { prompt } from './logic';

export default class HandlerInput {
  private line = '';
  private pos = 0;
  sigintWorks = false;

  private history: string[] = [];
  private historyPos = 0;
  private tempLine?: string;
  private tempHistory: { [k: number]: string } = {};

  constructor(
    private writeEmitter: EventEmitter<string>,
    private writeCommand: InstanceType<typeof ClipsRepl>['writeCommand']
  ) {}

  addToHistory(line: string) {
    this.history.push(line);
    delete this.tempHistory[this.historyPos];
    this.historyPos = this.history.length;
    delete this.tempLine;
  }

  getFromHistory(pos: number) {
    if (pos in this.tempHistory) {
      return this.tempHistory[pos];
    }
    return this.history[pos];
  }

  handle = (data: string): void => {
    logger.logVerbose('LINE:', JSON.stringify(this.line));
    logger.logVerbose('DATA IN:', JSON.stringify(data));
    switch (data) {
      case '\r':
        this.writeEmitter.fire('\r\n');
        this.writeCommand(this.line, true);
        this.addToHistory(this.line);
        this.line = '';
        this.pos = 0;
        return;
      case '\x7f': // Backspace
      case '\b': // Backspace (escape code)
        if (this.pos === 0) {
          return;
        }
        this.line =
          this.line.slice(0, this.pos - 1) + this.line.slice(this.pos);
        this.pos--;
        // Move cursor backward
        this.writeEmitter.fire('\x1b[D');
        // Delete character
        this.writeEmitter.fire('\x1b[P');
        return;
      case '\x1b[A': // up arrow
        if (this.historyPos > 0) {
          // If the historyPos is not within bounds of history, save the current line in a variable
          if (this.historyPos > this.history.length - 1) {
            this.tempLine = this.line;
          } else if (this.line !== this.history[this.historyPos]) {
            // If the history entry was modified, save it in a special temp history object
            this.tempHistory[this.historyPos] = this.line;
          }
          this.line = this.getFromHistory(--this.historyPos);

          this.updateLine();
        }
        return;
      case '\x1b[B': // down arrow
        if (this.historyPos < this.history.length) {
          // If the history entry was modified, save it in a special temp history object
          if (this.line !== this.history[this.historyPos]) {
            this.tempHistory[this.historyPos] = this.line;
          }
          this.historyPos++;
          // If the historyPos is not within bounds of history, restore the temp line
          if (this.historyPos > this.history.length - 1) {
            this.line = this.tempLine ?? '';
          } else {
            this.line = this.getFromHistory(this.historyPos);
          }

          this.updateLine();
        }
        return;
      case '\x1b[D': // left arrow
        if (this.pos === 0) {
          return;
        }
        this.pos--;
        break;
      case '\x1b[C': // right arrow
        if (this.pos >= this.line.length) {
          return;
        }
        this.pos++;
        break;
      case '\x1b[3~': // del key
        if (this.pos >= this.line.length) {
          return;
        }
        this.line =
          this.line.slice(0, this.pos) + this.line.slice(this.pos + 1);
        // Delete character
        this.writeEmitter.fire('\x1b[P');
        return;
      case '\x1b[H': // home key
        if (this.pos > 0) {
          this.writeEmitter.fire(`\x1b[${this.pos}D`);
          this.pos = 0;
        }
        return;
      case '\x1b[F': // end key
        const posDiffEnd = this.line.length - this.pos;
        if (posDiffEnd > 0) {
          this.writeEmitter.fire(`\x1b[${posDiffEnd}C`);
          this.pos = this.line.length;
        }
        return;
      case '\u0003': // SIGINT (Ctrl+C)
      case '\u0015': // (Ctrl+U) (used in terminals to delete line)
        this.deleteLine();

        this.line = '';
        this.pos = 0;

        // If the CLIPS version supports it and it was the SIGINT signal, also send it to the shell
        if (this.sigintWorks && data === '\u0003') {
          this.writeCommand(data, true);
        }
        return;
      case '\f': // Clear screen (Ctrl+L)
        // Clear the screen and move the cursor to the upper left
        this.writeEmitter.fire('\x1b[2J\x1b[f');

        // Rewrite the prompt and current line
        this.writeEmitter.fire(`${prompt} ${this.line}`);

        // Move the cursor back to the original position (if needed)
        const posDiff = this.line.length - this.pos;
        if (posDiff > 0) {
          this.writeEmitter.fire(`\x1b[${posDiff}D`);
        }

        return;
      default:
        // Support for typing characters at any position other than the end
        if (this.pos < this.line.length) {
          const before = this.line.slice(0, this.pos),
            after = this.line.slice(this.pos);
          this.writeEmitter.fire(data + after);
          this.line = before + data + after;
          // Move cursor back to the original position
          this.writeEmitter.fire(`\x1b[${after.length}D`);
        } else {
          this.writeEmitter.fire(data);
          this.line += data;
        }
        this.pos += data.length;
        return;
    }

    this.writeEmitter.fire(data);
  };

  private updateLine() {
    if (this.pos > 0) {
      this.deleteLine();
    }
    this.writeEmitter.fire(this.line);
    this.pos = this.line.length;
  }

  private deleteLine() {
    if (this.pos > 0) {
      // Move to the left 'pos' times (aka to the initial position)
      this.writeEmitter.fire(`\x1b[${this.pos}D`);
    }
    // Delete from cursor to the end of the line
    this.writeEmitter.fire('\x1b[K');
  }
}
