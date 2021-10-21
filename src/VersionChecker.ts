import { Event, EventEmitter } from 'vscode';
import { RedirectData } from './logic';

export namespace VersionChecker {
  function check(
    writeEmitter: EventEmitter<string>,
    sigintEmitter: EventEmitter<boolean>
  ): Parameters<Event<RedirectData>>[0] {
    return ([data, prepare]) => {
      /**
       * It looks like CLIPS considers '6.40' to be equivalent to '6.4', in which case '6.40 > 6.4' would be false.
       * But string comparison seems to work exactly like CLIPS version number comparison except for that.
       * '6.40 > 6.4' would be true, so we remove trailing zeros in the regex just to make sure it works for all cases.
       */
      const version = /\((.*?)0*\s/.exec(data)?.[1];
      const minVersion = '6.4';

      console.log('VERSION: ', JSON.stringify(version));

      // If the CLIPS version is >= 6.40, assume that SIGINT works
      const sigintWorks = version !== undefined && version >= minVersion;

      console.log('SIGINT WORKS: ', sigintWorks);

      sigintEmitter.fire(sigintWorks);

      // Sends the data to the original emitter
      writeEmitter.fire(prepare(data));
    };
  }

  export function setup(
    writeEmitter: EventEmitter<string>,
    sigintEmitter: EventEmitter<boolean>
  ) {
    const versionCheckEmitter = new EventEmitter<RedirectData>();

    versionCheckEmitter.event(check(writeEmitter, sigintEmitter));

    return versionCheckEmitter;
  }
}

export default VersionChecker;
