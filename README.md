# CLIPS IDE

The **CLIPS IDE** extension provides an IDE-like experience for the [**CLIPS**](http://www.clipsrules.net/) programming language inside Visual Studio Code.

![Screenshot](media/vscode-clips-ide.png)

## Features

![Open Animation](media/clips-open-env.gif)

### Terminal

Improved terminal experience over the _CLIPS REPL_ by including several features:

- Command Editing (moving, removing characters, etc.)
- Command History (`up/down arrow keys`)
- Clear Line (`Ctrl+U`) and Clear Screen (`Ctrl+L`)

![Terminal Animation](media/clips-terminal.gif)

### Views

- Facts
- Agenda
- Instances

These views update their state automatically after each command.

![Views Animation](media/clips-views.gif)

## Extension Settings

This extension contributes the following settings:

- `clips.clipsPath`: Specifies a custom path for the CLIPS command-line executable (CLIPSDOS) (empty by default).

  - If empty, the extension tries to auto-detect its path:

    - In Windows, it looks in the "Program Files" directory for a folder that includes the word "CLIPS", and then for the "CLIPSDOS.exe" file inside it.

    - If the one above fails, or it's a different OS, it assumes that a command called "clips" exists within the system's PATH env.

- `clips.defaultEnvironmentViews`: Selection of which views should be opened whenever the `Open CLIPS Environment` command is used (the `facts` and `agenda` views are enabled by default).

- `clips.defaultStrategy`: Specifies the default strategy used by CLIPS when running. (This value will only be set on startup) (`depth` by default).

- `clips.logLevel`: Sets the log level for the extension (`off` by default). Only useful for _testing/debugging_ purposes.

- `clips.updateViews`: Controls whether views should be automatically updated after each command (`true` by default).

![Settings Animation](media/clips-settings.gif)

## Release Notes

### 1.2.0

Added progress bar when updating views is taking longer than usual (more than a second)

Added setting to set a custom path for the CLIPS executable

Added setting to set the default strategy used by CLIPS when each session starts

Added command to set the strategy for the current session

Added button for updating each view manually

Added setting to toggle views auto updating their state after each command

Fixed error message not showing up if the CLIPS executable is not found (in Linux)

### 1.1.0

The extension finally works on Windows :tada:

This means that issue [#1](https://github.com/algono/clips-ide-vscode/issues/1) was fixed.

### 1.0.4

Updated README to add the newly created issue ([#1](https://github.com/algono/clips-ide-vscode/issues/1)).

### 1.0.3

Fixed - Error message was not being shown when the CLIPS terminal failed to spawn.

Found issue - The CLIPS terminal does not spawn on Windows, even if the path is correct.

### 1.0.2

Fixed - Views not updating when they were hidden in a tab and then selected.

### 1.0.1

Improved the system that makes views close when CLIPS is closed.

(It is not perfect due to VSCode limitations, but it now works in more cases than before.)

### 1.0.0

Initial release of CLIPS IDE.
