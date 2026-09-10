import { promises as fs } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

import { validateWorldSnapshot, type WorldSnapshot } from "./world-snapshot.ts";
import { ProjectError, type ProjectWriteService } from "./project-types.ts";

interface WorldServer extends Server {
  projectService?: ProjectWriteService;
  drainProjectWrites(): Promise<void>;
}

/** The launcher binds to loopback and explicitly attaches the narrow write capability. */
export function createWorldServer(readSnapshot: () => WorldSnapshot, buildDirectory: string): WorldServer {
  const writes = new Set<Promise<unknown>>();
  const server = createServer(async (request, response) => {
    const fail = (status: number, error: string, message?: string) => {
      response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ error, ...(message === undefined ? {} : { message }) }));
    };
    if (request.method !== "GET" && request.method !== "POST") {
      response.setHeader("Allow", "GET, POST");
      fail(405, "Metoden er ikke tillatt");
      return;
    }
    const address = server.address();
    const hosts = request.rawHeaders.filter((_, index) => index % 2 === 0
      && request.rawHeaders[index]!.toLowerCase() === "host");
    if (!address || typeof address === "string" || address.address !== "127.0.0.1"
      || hosts.length !== 1 || request.headers.host !== `127.0.0.1:${address.port}`) {
      if (request.method === "POST") fail(403, "forbidden_origin", "Forespørselen er ikke tillatt");
      else fail(400, "Ugyldig vert");
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
    if (request.method === "POST") {
      const create = /^\/api\/civilizations\/([^/]+)\/projects$/u.exec(pathname);
      const retry = /^\/api\/projects\/([^/]+)\/retry$/u.exec(pathname);
      if (!create && !retry) {
        response.setHeader("Allow", "GET");
        fail(405, "Metoden er ikke tillatt");
        return;
      }
      if (request.headers.origin !== `http://127.0.0.1:${address.port}`
        || (request.headers["sec-fetch-site"] !== undefined && request.headers["sec-fetch-site"] !== "same-origin")
        || !/^application\/json(?:\s*;[^\r\n]*)?$/u.test(request.headers["content-type"] ?? "")) {
        fail(403, "forbidden_origin", "Forespørselen er ikke tillatt");
        return;
      }
      try {
        const length = request.headers["content-length"];
        if (length === undefined || !/^\d+$/u.test(length) || Number(length) > 8192) {
          throw new ProjectError("invalid_request");
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > 8192 || bytes > Number(length)) throw new ProjectError("invalid_request");
          chunks.push(chunk);
        }
        if (!request.complete || bytes !== Number(length)) throw new ProjectError("invalid_request");
        let body: unknown;
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { throw new ProjectError("invalid_request"); }
        if (!server.projectService) throw new ProjectError("harness_unavailable");
        const operation = create ? server.projectService.create(create[1]!, body)
          : server.projectService.retry(retry![1]!, body).then((project) => ({ project, created: false }));
        writes.add(operation);
        const result = await operation.finally(() => writes.delete(operation));
        response.writeHead(result.created ? 201 : 200, {
          "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
        });
        response.end(JSON.stringify(result.project));
      } catch (error) {
        const code = error instanceof ProjectError ? error.code : "invalid_request";
        const status = ["slug_taken", "path_taken", "request_key_conflict", "retry_in_progress", "civilization_dissolved"].includes(code)
          ? 409 : code === "busy" || code === "harness_unavailable" ? 503 : 400;
        fail(status, code, "Prosjektforespørselen kunne ikke fullføres");
      }
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
  }) as WorldServer;
  server.drainProjectWrites = async () => {
    while (writes.size > 0) {
      await Promise.allSettled([...writes]);
    }
  };
  // Framing errors (including a truncated Content-Length) never expose parser details.
  server.on("clientError", (_error, socket) => {
    if (!socket.writable || socket.writableEnded) return;
    const body = JSON.stringify({ error: "invalid_request", message: "Prosjektforespørselen kunne ikke fullføres" });
    socket.end(`HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  });
  return server;
}
