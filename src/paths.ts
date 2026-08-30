import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export function defaultStateDirectory(
  environment: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const xdgDataHome = environment.XDG_DATA_HOME;
  if (xdgDataHome !== undefined && xdgDataHome !== "") {
    if (!isAbsolute(xdgDataHome)) {
      throw new Error("XDG_DATA_HOME must be an absolute path");
    }
    return join(xdgDataHome, "ecosym");
  }
  return join(home, ".local", "share", "ecosym");
}
