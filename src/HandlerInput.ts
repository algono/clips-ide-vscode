import { EventEmitter } from 'vscode';
import ClipsRepl from './ClipsRepl';
import * as logger from './Logger';

export default class HandlerInput {
  private line = '';
  private pos = 0;
  sigintWorks = false;

  constructor(
    private writeEmitter: EventEmitter<string>,
    private writeCommand: InstanceType<typeof ClipsRepl>['writeCommand']
  ) {}

  handle = (data: string): void => {
    logger.logVerbose('LINE:', JSON.stringify(this.line));
    logger.logVerbose('DATA IN:', JSON.stringify(data));
    switch (data) {
      case '\r':
        this.writeEmitter.fire('\r\n');
        this.writeCommand(this.line, true);
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
      case '\x1b[B': // down arrow
        // CLIPS does not seem to support command history with up and down arrows
        // so we just ignore them
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
      case '\u0003': // SIGINT (Ctrl+C)
      case '\u0015': // (Ctrl+U) (used in terminals to delete this.line)
        if (this.pos === 0) {
          return;
        }
        // Move to the left 'this.pos' times (aka to the initial this.position)
        this.writeEmitter.fire(`\x1b[${this.pos}D`);
        // Delete from cursor to the end of the this.line
        this.writeEmitter.fire('\x1b[K');

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
        this.writeEmitter.fire(`CLIPS> ${this.line}`);

        // Move the cursor back to the original position (if needed)
        const posDiff = this.line.length - this.pos;
        if (posDiff > 0) {
          this.writeEmitter.fire(`\x1b[${posDiff}D`);
        }

        return;
      default:
        // Support for typing characters at any this.position other than the end
        if (this.pos < this.line.length) {
          const before = this.line.slice(0, this.pos),
            after = this.line.slice(this.pos);
          this.writeEmitter.fire(data + after);
          this.line = before + data + after;
          // Move cursor back to the original this.position
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
}
