import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript";

function checkClosure(roots: string[], read = (path: string) => readFileSync(path, "utf8")) {
  const seen = new Set<string>();
  function visit(path: string, chain: string[]) {
    assert.doesNotMatch(path, /[/\\]arena[^/\\]*\.(?:ts|json)$/, chain.join(" -> "));
    if (seen.has(path) || !/\.[cm]?[jt]sx?$/.test(path)) return;
    seen.add(path);
    const file = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
    function walk(node: ts.Node) {
      let specifier: ts.Node | undefined;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal;
      if (ts.isExternalModuleReference(node)) specifier = node.expression;
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        specifier = node.arguments[0];
        assert.ok(specifier && ts.isStringLiteralLike(specifier), `Nonliteral module dependency: ${path}`);
      }
      if (specifier && ts.isStringLiteralLike(specifier) && specifier.text.startsWith(".")) {
        const target = resolve(dirname(path), specifier.text);
        visit(target, [...chain, target]);
      }
      ts.forEachChild(node, walk);
    }
    walk(file);
  }
  for (const root of roots) visit(resolve(root), [root]);
  return seen;
}

test("world transport, projection, form and all web modules have no transitive Arena adapter/schema dependency", () => {
  // world-main is the composition root that constructs owners, not transport or form.
  const seen = checkClosure(["src/world-application.ts", "src/world-snapshot.ts", "src/world-form.ts", "src/world-server.ts",
    ...globSync("web/**/*.{ts,tsx}")]);
  assert.ok(seen.has(resolve("src/source-report-time.ts")), "Generic UTC report chronology is allowed");
});

test("dependency guard kills indirect type, re-export, dynamic and schema import mutations", () => {
  for (const dependency of [
    'import type { ArenaBundle } from "./arena-adapter.ts";',
    'export * from "./arena-adapter.ts";',
    'type Bundle = import("./arena-adapter.ts").ArenaBundle;',
    'const bundle = import("./arena-adapter.ts");',
    'import schema from "./arena-observation-bundle-v1.schema.json";',
  ]) {
    const files = new Map([
      [resolve("synthetic/world-form.ts"), 'import "./generic.ts";'],
      [resolve("synthetic/generic.ts"), dependency],
    ]);
    assert.throws(() => checkClosure(["synthetic/world-form.ts"], (path) => {
      assert.ok(files.has(path));
      return files.get(path)!;
    }), /arena/);
  }
});
