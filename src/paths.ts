import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { ProjectError } from "./project-types.ts";

export function projectsRoot(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const explicit = env.ECOSYM_PROJECT_ROOT;
  const data = env.XDG_DATA_HOME;
  const root = explicit !== undefined ? explicit
    : data !== undefined && data !== "" ? join(data, "ecosym-projects")
    : join(home, ".local", "share", "ecosym-projects");
  if (!isAbsolute(root) || (explicit === undefined && data && !isAbsolute(data))) {
    throw new ProjectError("root_invalid");
  }
  return root;
}

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
