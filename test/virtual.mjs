// Unit tests for the virtual Python document and its position map.
// Run with `npm test` (after `npm run compile`).

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildVirtual } from "../out/virtual.js";

const here = dirname(fileURLToPath(import.meta.url));

const SRC = `<template>
  <div class="todo-app">
    <h1>Todos <small>{{ remaining_label }} left</small></h1>
    <input @bind="draft" placeholder="what needs doing?" />
    <button @click="add">add</button>
    <ul>
      <For each="item in items" key="item['id']" index="i">
        <TodoItem :item="item" @toggle="toggle(event)" @remove="remove(event)" />
      </For>
    </ul>
    <If cond="not items">
      <p class="hint">nothing yet</p>
    </If>
  </div>
</template>

<code>
import humanize

draft: str = ""
items: list = []

@property
def remaining_label(self):
    return humanize.apnumber(len(self.items))

def add(self):
    self.items.append({"id": 1, "text": self.draft})
</code>
`;

const lines = SRC.split("\n");
const lineOf = (needle) => lines.findIndex((l) => l.includes(needle));
const colOf = (needle, sub) => lines[lineOf(needle)].indexOf(sub);

function pythonParses(text) {
  const r = spawnSync("python", ["-c", "import ast, sys; ast.parse(sys.stdin.read())"], {
    input: text,
    encoding: "utf8",
  });
  return { ok: r.status === 0, err: r.stderr };
}

test("the generated document is valid Python", () => {
  const { text } = buildVirtual(SRC);
  const { ok, err } = pythonParses(text);
  assert.ok(ok, err + "\n" + text);
});

test("code block lines are shifted right by four columns", () => {
  const v = buildVirtual(SRC);
  const w = { line: lineOf("self.items.append"), character: colOf("self.items.append", "items") };
  const p = v.toVirtual(w);
  assert.ok(p, "maps");
  const vline = v.text.split("\n")[p.line];
  assert.equal(vline.slice(p.character, p.character + 5), "items");
  assert.equal(vline.startsWith("        self.items.append"), true);
  assert.deepEqual(v.toWeft(p), w);
});

test("interpolation becomes a parenthesised expression", () => {
  const v = buildVirtual(SRC);
  const w = { line: lineOf("remaining_label }}"), character: colOf("remaining_label }}", "remaining_label") };
  const p = v.toVirtual(w);
  assert.ok(p);
  const vline = v.text.split("\n")[p.line];
  assert.equal(vline.trim(), "( remaining_label )");
  assert.equal(vline.slice(p.character, p.character + 15), "remaining_label");
  assert.deepEqual(v.toWeft(p), w);
});

test("template text outside expressions does not map", () => {
  const v = buildVirtual(SRC);
  assert.equal(v.toVirtual({ line: lineOf("<h1>Todos"), character: colOf("<h1>Todos", "Todos") }), null);
  assert.equal(v.toVirtual({ line: lineOf("placeholder="), character: colOf("placeholder=", "needs") }), null);
});

test("For loops become real for statements with the loop variable in scope", () => {
  const v = buildVirtual(SRC);
  const t = v.text;
  assert.match(t, /^ {8}for item in \(items\):$/m);
  assert.match(t, /^ {12}i = 0$/m);
  assert.match(t, /^ {12}\(item\['id'\]\)$/m);
  assert.match(t, /^ {12}\(item\)$/m);
  assert.match(t, /^ {12}\(toggle\(event\)\)$/m);
  // the <If> after the loop is back at the outer indent
  assert.match(t, /^ {8}\(not items\)$/m);
});

test("top-level names are aliased so bare template names resolve", () => {
  const v = buildVirtual(SRC);
  for (const name of ["humanize", "draft", "items", "remaining_label", "add", "emit"]) {
    assert.match(v.text, new RegExp(`^ {8}${name} = self\\.${name}$`, "m"), name);
  }
  assert.doesNotMatch(v.text, /^ {8}property = self\.property$/m);
});

test("imports and constants are duplicated at module level for the methods", () => {
  const v = buildVirtual(SRC);
  const vlines = v.text.split("\n");
  const cls = vlines.indexOf("class _Weft(Component):");
  assert.ok(vlines.slice(0, cls).includes("import humanize"), "module-level import");
  assert.ok(vlines.slice(0, cls).includes('draft: str = ""'), "module-level field");
  assert.ok(!vlines.slice(0, cls).some((l) => l.startsWith("def ") || l.startsWith("@")), "no methods at module level");
  // the duplicate maps through to the class copy and then to the .weft line
  const modLine = vlines.indexOf("import humanize");
  const dup = v.moduleDup.get(modLine);
  assert.ok(dup);
  assert.equal(vlines[dup.line], "    import humanize");
  // column 7 ("humanize") on the module copy + shift = the class copy column
  assert.deepEqual(v.toWeft({ line: dup.line, character: 7 + dup.shift }), { line: lineOf("import humanize"), character: 7 });
});

test("multi-line and compound top-level statements stay in one block", () => {
  const src = `<template><p/></template>\n<code>\nTABLE = {\n    "a": 1,\n}\nif TABLE:\n    x = 1\nelse:\n    x = 2\n\ndef go(self):\n    return x\n</code>\n`;
  const v = buildVirtual(src);
  const vlines = v.text.split("\n");
  const cls = vlines.indexOf("class _Weft(Component):");
  assert.deepEqual(vlines.slice(0, cls).filter((l) => l), ["from typing import Any", "from pyweft import Component", "TABLE = {", '    "a": 1,', "}", "if TABLE:", "    x = 1", "else:", "    x = 2"]);
  assert.ok(pythonParses(v.text).ok, v.text);
});

test("aliases record where self.<name> sits on the alias line", () => {
  const v = buildVirtual(SRC);
  const p = v.aliases.get("remaining_label");
  assert.ok(p);
  const vline = v.text.split("\n")[p.line];
  assert.equal(vline, "        remaining_label = self.remaining_label");
  assert.equal(vline.slice(p.character), "remaining_label");
  assert.equal(v.toWeft(p), null, "alias lines are scaffolding, not user text");
});

test("directive values map character for character", () => {
  const v = buildVirtual(SRC);
  const w = { line: lineOf('@toggle="toggle(event)"'), character: colOf('@toggle="toggle(event)"', "toggle(event)") + 7 };
  const p = v.toVirtual(w);
  assert.ok(p);
  assert.equal(v.text.split("\n")[p.line][p.character], "e");
  assert.deepEqual(v.toWeft(p), w);
});

test("an empty <For> body and a self-closing <For> still parse", () => {
  const { text } = buildVirtual(`<template><For each="x in xs"></For><For each="y in ys" /></template>`);
  assert.ok(pythonParses(text).ok, text);
  assert.match(text, /for x in \(xs\):\n {12}pass/);
});

test("a <style> block contributes nothing and does not shift template mapping", () => {
  const src = `<template><p>{{ count }}</p></template>\n<style>\np > span { color: red }\n</style>\n<code>\ncount: int = 0\n</code>\n`;
  const v = buildVirtual(src);
  assert.ok(pythonParses(v.text).ok, v.text);
  assert.doesNotMatch(v.text, /color: red/);
  const p = v.toVirtual({ line: 0, character: "<template><p>{{ ".length });
  assert.ok(p);
  assert.equal(v.text.split("\n")[p.line].trim(), "( count )");
});

test("a file with no code block still produces a class", () => {
  const { text } = buildVirtual(`<template><p>{{ 1 + 1 }}</p></template>`);
  assert.ok(pythonParses(text).ok, text);
});

test("the shipped examples generate valid Python", () => {
  for (const rel of ["examples/todo/app.weft", "examples/todo/todo_item.weft", "examples/counter.weft"]) {
    const path = join(here, "..", "..", "python_framework", rel);
    if (!existsSync(path)) continue;
    const { text } = buildVirtual(readFileSync(path, "utf8"));
    const { ok, err } = pythonParses(text);
    assert.ok(ok, rel + ": " + err + "\n" + text);
  }
});
