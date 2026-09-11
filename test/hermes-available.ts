import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

export function hermesAvailable(path: string | undefined): boolean {
  // Match HermesProjectAdapter's executable resolution, without invoking a shell.
  return (path ?? "/usr/local/bin:/usr/bin:/bin").split(delimiter).filter(isAbsolute).some((directory) => {
    try {
      const binary = realpathSync(join(directory, "hermes"));
      if (!statSync(binary).isFile()) return false;
      accessSync(binary, constants.X_OK);
      return true;
    } catch { return false; }
  });
}
