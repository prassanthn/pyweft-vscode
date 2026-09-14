// Tokenises sample .weft sources with the real TextMate engine and asserts
// the scopes the grammar assigns. Run with `npm test`.
//
// The real Python grammar ships with VS Code and is stubbed here, so
// assertions stop at the meta.embedded.* boundary this grammar draws around
// Python regions; that boundary is exactly what VS Code uses to hand those
// regions to the Python grammar and language configuration.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vsctm from "vscode-textmate";
import oniguruma from "vscode-oniguruma";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const grammarPath = join(here, "..", "syntaxes", "weft.tmLanguage.json");

const wasmBin = readFileSync(
  join(dirname(require.resolve("vscode-oniguruma")), "onig.wasm")
).buffer;
const onigLib = oniguruma.loadWASM(wasmBin).then(() => ({
  createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
  createOnigString: (s) => new oniguruma.OnigString(s),
}));

// A rule that includes a grammar the registry cannot load is dropped
// wholesale, so stand in for VS Code's bundled Python grammar with a stub.
// Anything it matches simply stays scoped by the surrounding meta.embedded.*.
const PYTHON_STUB = {
  scopeName: "source.python",
  patterns: [{ match: "\\b(def|class|return|in|not|and|or)\\b", name: "keyword.python" }],
};

const registry = new vsctm.Registry({
  onigLib,
  loadGrammar: async (scopeName) => {
    if (scopeName === "source.weft") {
      return vsctm.parseRawGrammar(readFileSync(grammarPath, "utf8"), grammarPath);
    }
    if (scopeName === "source.python") return PYTHON_STUB;
    return null;
  },
});

const SAMPLE = `<template>
  <div class="todo-app">
    <!-- a comment -->
    <h1>Todos <small>{{ remaining_label }} left</small></h1>
    <input @bind="draft" placeholder="what needs doing?" />
    <button @click="add">add</button>
    <a href="{{ url }}" @click='go'>mail me at me@example.com &amp; more</a>
    <span py-at-click="legacy" py-colon-title="t">x</span>
    <ul>
      <For each="item in items" key="item['id']" index="i">
        <TodoItem :item="item" @toggle="toggle(event)" @remove="remove(event)" />
      </For>
    </ul>
    <If cond="not items">
      <p class="hint">nothing yet</p>
    </If>
    <ElseIf cond="len(items) > 3"><p>many</p></ElseIf>
    <Else><p>some</p></Else>
  </div>
</template>

<code>
draft: str = ""
items: list = []

def add(self):
    self.items.append({"id": 1, "text": self.draft})
</code>
`;

const grammar = await registry.loadGrammar("source.weft");
const lines = SAMPLE.split("\n");
const tokensByLine = [];
let stack = vsctm.INITIAL;
for (const line of lines) {
  const result = grammar.tokenizeLine(line, stack);
  tokensByLine.push(
    result.tokens.map((t) => ({
      text: line.slice(t.startIndex, t.endIndex),
      start: t.startIndex,
      scopes: t.scopes,
    }))
  );
  stack = result.ruleStack;
}

let failures = 0;
function tokenFor(lineText, substr) {
  const lineNo = lines.findIndex((l) => l.includes(lineText));
  if (lineNo < 0) throw new Error(`no line containing ${lineText}`);
  const col = lines[lineNo].indexOf(substr);
  if (col < 0) throw new Error(`no ${JSON.stringify(substr)} in line ${lineNo}`);
  const tok = tokensByLine[lineNo].find(
    (t) => t.start <= col && col < t.start + t.text.length
  );
  return { tok, lineNo };
}
function expect(lineText, substr, scope, present = true) {
  const { tok, lineNo } = tokenFor(lineText, substr);
  const has = tok.scopes.some((s) => s === scope || s.startsWith(scope + "."));
  if (has !== present) {
    failures++;
    console.log(
      `FAIL line ${lineNo + 1}: ${JSON.stringify(substr)} should ${present ? "" : "NOT "}have ${scope}\n` +
        `     token ${JSON.stringify(tok.text)} scopes: ${tok.scopes.join(" ")}`
    );
  }
}
const expectNot = (l, s, scope) => expect(l, s, scope, false);

// section tags
expect("<template>", "template", "entity.name.tag.section.weft");
expect("<code>", "code", "entity.name.tag.section.weft");
expect("</code>", "code", "entity.name.tag.section.weft");

// comments and text
expect("<!-- a comment -->", "a comment", "comment.block.xml.weft");
expect("<h1>Todos", "Todos", "meta.block.template.weft");
expectNot("<h1>Todos", "Todos", "meta.tag");
expect("&amp;", "&amp;", "constant.character.entity.xml.weft");

// interpolation
expect("remaining_label", "remaining_label", "meta.embedded.line.python");
expect("remaining_label", "remaining_label", "meta.interpolation.weft");
expect("remaining_label", "{{", "punctuation.section.interpolation.begin.weft");
expect("remaining_label", " left", "meta.block.template.weft");
expectNot("remaining_label", " left", "meta.embedded");

// plain html tag and attribute with interpolation inside the value
expect("<input", "input", "entity.name.tag.weft");
expect("<input", "placeholder", "entity.other.attribute-name.weft");
expect("<input", "what needs doing?", "string.quoted.attribute.weft");
expect("<a href", "url", "meta.embedded.line.python");
expect("<a href", "url", "string.quoted.attribute.weft");

// directives, both spellings and both quote styles
expect("<input", "bind", "entity.other.attribute-name.event.weft");
expect("<input", "draft", "meta.embedded.line.python");
expect("<button", "click", "entity.other.attribute-name.event.weft");
expect("<button", "add\"", "meta.embedded.line.python");
expect("<a href", "go", "meta.embedded.line.python");
expect("<a href", "mail me", "meta.block.template.weft");
expectNot("<a href", "mail me", "meta.embedded");
expect("py-at-click", "click", "entity.other.attribute-name.event.weft");
expect("py-at-click", "legacy", "meta.embedded.line.python");
expect("py-colon-title", "title", "entity.other.attribute-name.binding.weft");

// @ in text is not a directive
expectNot("me@example.com", "@example", "entity.other.attribute-name");

// control flow
expect("<For each", "For", "keyword.control.weft");
expect("<For each", "each", "entity.other.attribute-name.expression.weft");
expect("<For each", "item in", "variable.parameter.loop.weft");
expect("<For each", "in items", "keyword.operator.logical.python");
expect("<For each", "items\"", "meta.embedded.line.python");
expect("<For each", "key", "entity.other.attribute-name.expression.weft");
expect("<For each", "item['id']", "meta.embedded.line.python");
expect("<For each", "index", "entity.other.attribute-name.expression.weft");
expect("</For>", "For", "keyword.control.weft");
expect("<If cond", "If", "keyword.control.weft");
expect("<If cond", "cond", "entity.other.attribute-name.expression.weft");
expect("<If cond", "not items", "meta.embedded.line.python");
expect("<ElseIf", "ElseIf", "keyword.control.weft");
expect("<ElseIf", "len(items) > 3", "meta.embedded.line.python");
expect("<Else>", "Else", "keyword.control.weft");

// component tag with typed prop and events
expect("<TodoItem", "TodoItem", "entity.name.tag.component.weft");
expect("<TodoItem", ":item", "punctuation.definition.directive.binding.weft");
expect("<TodoItem", "item=", "entity.other.attribute-name.binding.weft");
expect("<TodoItem", "toggle=", "entity.other.attribute-name.event.weft");
expect("<TodoItem", "toggle(event)", "meta.embedded.line.python");
expect("<TodoItem", "remove(event)", "meta.embedded.line.python");
expect("<TodoItem", "/>", "punctuation.definition.tag.end.weft");

// code block content is python, including nested braces and quotes
expect('draft: str = ""', "draft", "meta.embedded.block.python");
expect("def add(self):", "def add", "meta.embedded.block.python");
expect('self.items.append', '{"id": 1', "meta.embedded.block.python");
expectNot('self.items.append', '{"id": 1', "meta.interpolation.weft");

// the whole template region is scoped, and the code region is not
expect("<p class=\"hint\">", "hint", "meta.block.template.weft");
expectNot("def add(self):", "def add", "meta.block.template.weft");

// the real example files must tokenise without throwing
for (const rel of ["examples/todo/app.weft", "examples/todo/todo_item.weft", "examples/counter.weft"]) {
  const path = join(here, "..", "..", "python_framework", rel);
  try {
    let st = vsctm.INITIAL;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      st = grammar.tokenizeLine(line, st).ruleStack;
    }
  } catch (err) {
    if (err.code === "ENOENT") continue; // framework not checked out alongside
    throw err;
  }
}

if (failures) {
  console.log(`\n${failures} scope assertion(s) failed`);
  process.exit(1);
}
console.log("grammar scopes OK");
