import { promises as fs } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

import { validateWorldSnapshot, type WorldSnapshot } from "./world-snapshot.ts";

/** The launcher binds this server to 127.0.0.1; no store mutation capability is accepted. */
export function createWorldServer(readSnapshot: () => WorldSnapshot, buildDirectory: string): Server {
  const server = createServer(async (request, response) => {
    const fail = (status: number, error: string) => {
      response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ error }));
    };
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      fail(405, "Metoden er ikke tillatt");
      return;
    }
    const address = server.address();
    const hosts = request.rawHeaders.filter((_, index) => index % 2 === 0
      && request.rawHeaders[index]!.toLowerCase() === "host");
    if (!address || typeof address === "string" || address.address !== "127.0.0.1"
      || hosts.length !== 1 || request.headers.host !== `127.0.0.1:${address.port}`) {
      fail(400, "Ugyldig vert");
      return;
    }
    let pathname: string;
    try {
      const raw = request.url ?? "";
      if (!raw.startsWith("/") || raw.startsWith("//")) throw new Error("Invalid path");
      pathname = decodeURIComponent(raw.split("?")[0]!);
      // Reject before URL normalization can erase traversal, including double encoding.
      if (/[\\%\x00-\x1f\x7f#]/u.test(pathname) || pathname.split("/").includes("..")) {
        throw new Error("Invalid path");
      }
    } catch {
      fail(400, "Ugyldig sti");
      return;
    }
    if (pathname === "/api/world-snapshot") {
      try {
        const snapshot = validateWorldSnapshot(readSnapshot());
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        response.end(JSON.stringify(snapshot));
      } catch {
        fail(500, "Verdensdata kunne ikke leses");
      }
      return;
    }
    const file = pathname === "/" ? "index.html" : pathname.slice(1);
    const contentType = new Map([
      [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
      [".css", "text/css; charset=utf-8"],
    ]).get(extname(file));
    if (!contentType) { fail(404, "Ikke funnet"); return; }
    try {
      const root = await fs.realpath(buildDirectory);
      const target = await fs.realpath(resolve(root, file));
      const within = relative(root, target);
      if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) {
        fail(403, "Stien er ikke tillatt");
        return;
      }
      const content = await fs.readFile(target);
      response.writeHead(200, {
        "Content-Type": contentType, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      });
      response.end(content);
    } catch {
      fail(404, "Ikke funnet");
    }
  });
  return server;
}
