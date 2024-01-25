# Change Log

## [1.2.3] - 25-01-2024

- Fixed - Only open the output channel when logging an error

## [1.2.2] - 25-01-2024

- Added notice about the extension being **UNMAINTAINED**

- Fixed - Logs not being shown on VSCode's output channel

- Added - New log level: "error"

## [1.2.1] - 15-04-2023

- [Dependabot] - Updated project dependencies to fix "minimatch ReDoS vulnerability" from the "minimatch" package (dev dependency)

## [1.2.0] - 2-11-2021

- Added - Show progress bar when updating views is taking longer than usual (more than a second)

- Added - Setting to set a custom path for the CLIPS executable

- Added - Setting to set the default strategy used by CLIPS when each session starts

- Added - Command to set the strategy for the current session

- Added - Button for updating each view manually

- Added - Setting to toggle views auto updating their state after each command

- Fixed - Error message not showing up if the CLIPS executable is not found (in Linux)

## [1.1.0] - 31-10-2021

- Fixed issue [#1](https://github.com/algono/clips-ide-vscode/issues/1) (Terminal does not work on Windows).

## [1.0.4] - 31-10-2021

- Updated README to add the newly created issue ([#1](https://github.com/algono/clips-ide-vscode/issues/1)).

## [1.0.3] - 29-10-2021

- Fixed - Error message was not being shown when the CLIPS terminal failed to spawn.
- Found issue - The CLIPS terminal does not spawn on Windows, even if the path is correct.

## [1.0.2] - 28-10-2021

- Fixed - Views not updating when they were hidden in a tab and then selected.

## [1.0.1] - 27-10-2021

- Improved the system that makes views close when CLIPS is closed.
  - It is not perfect due to VSCode limitations, but it now works in more cases than before.

## [1.0.0] - 26-10-2021

- Initial release
