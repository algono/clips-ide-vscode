# CLIPS IDE

The **CLIPS IDE** extension provides an IDE-like experience for the [**CLIPS**](http://www.clipsrules.net/) programming language inside Visual Studio Code.

## Features

![Screenshot](media/vscode-clips-ide.png)

### Terminal

Improved terminal experience over the *CLIPS REPL* by including several features:

- Command Editing (moving, removing characters, etc.)
- Command History (`up/down arrow keys`)
- Clear Line (`Ctrl+U`) and Clear Screen (`Ctrl+L`)

### Views

- Facts
- Agenda
- Instances

These views update their state automatically after each command.

## Extension Settings

This extension contributes the following settings:

- `clips.defaultEnvironmentViews`: Selection of which views should be opened whenever the `Open CLIPS Environment` command is used (the `facts` and `agenda` views are enabled by default).
- `clips.logLevel`: Sets the log level for the extension (`off` by default). Only useful for _testing/debugging_ purposes.

## Release Notes

### 1.0.0

Initial release of CLIPS IDE.
