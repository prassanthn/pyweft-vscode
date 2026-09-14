// Runs inside the Extension Development Host (see test/e2e/run.js).
// Opens the todo example and drives the real providers end to end: our
// forwarding -> virtual document -> whatever Python language server is
// installed. Results are written as JSON to $PYWEFT_E2E_OUT.

const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function completionsAt(uri, position) {
  const list = await vscode.commands.executeCommand("vscode.executeCompletionItemProvider", uri, position);
  return (list?.items ?? []).map((i) => (typeof i.label === "string" ? i.label : i.label.label));
}

exports.run = async () => {
  const out = process.env.PYWEFT_E2E_OUT;
  const results = { checks: {} };
  const check = (name, ok, detail) => {
    results.checks[name] = { ok: Boolean(ok), detail };
  };
  try {
    const ext = vscode.extensions.getExtension("prassanthn.pyweft");
    const api = await ext.activate();
    const pylance = vscode.extensions.getExtension("ms-python.vscode-pylance");
    results.pylance = Boolean(pylance);
    if (pylance) await pylance.activate();

    const folder = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const doc = await vscode.workspace.openTextDocument(path.join(folder, "app.weft"));
    await vscode.window.showTextDocument(doc);
    const text = doc.getText().split("\n");
    const lineOf = (s) => text.findIndex((l) => l.includes(s));
    const pos = (needle, sub, extra = 0) => new vscode.Position(lineOf(needle), text[lineOf(needle)].indexOf(sub) + extra);

    const entry = await api.docs.ensure(doc);
    results.shadow = entry.uri.fsPath;
    check("shadow file lives under .pyweft with a self-ignoring .gitignore",
      entry.uri.fsPath.includes(`${path.sep}.pyweft${path.sep}`) && fs.existsSync(path.join(folder, ".pyweft", ".gitignore")),
      entry.uri.fsPath);

    // Pylance warms up asynchronously; poll until the code block answers.
    const codeDot = pos("self.items.append", "self.", 5);
    let labels = [];
    for (let i = 0; i < 60; i++) {
      labels = await completionsAt(doc.uri, codeDot);
      if (labels.includes("items")) break;
      await sleep(1000);
    }
    check("code block: self. completes fields and methods", ["items", "draft", "add", "toggle"].every((n) => labels.includes(n)), labels.slice(0, 40));

    // Cursor after "rem": the server prefix-filters, so expect the two rem* names.
    labels = await completionsAt(doc.uri, pos("{{ remaining_label }}", "remaining_label", 3));
    check("template: {{ }} completes component names", ["remaining_label", "remove"].every((n) => labels.includes(n)), labels.slice(0, 40));

    labels = await completionsAt(doc.uri, pos('<TodoItem :item="item"', ':item="item', 8));
    check("template: For loop variable is in scope", labels.includes("item") && labels.includes("items"), labels.slice(0, 40));

    // VS Code adds word-based suggestions from the file itself, so test for a
    // builtin that only a Python server would offer and that the file never mentions.
    labels = await completionsAt(doc.uri, pos("<h1>Todos", "Todos", 2));
    check("template: plain text gets no Python completions", !labels.includes("print"), labels.slice(0, 10));

    const hovers = await vscode.commands.executeCommand("vscode.executeHoverProvider", doc.uri, pos("{{ remaining_label }}", "remaining_label", 3));
    const hoverText = (hovers ?? []).flatMap((h) => h.contents.map((c) => (typeof c === "string" ? c : c.value))).join("\n");
    check("template: hover shows the property", hoverText.includes("remaining_label"), hoverText.slice(0, 200));

    const defs = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", doc.uri, pos('@toggle="toggle(event)"', "toggle(event)", 2));
    const def = (defs ?? [])[0];
    const defLine = def ? (def.targetRange ?? def.range).start.line : -1;
    check("template: go to definition lands on def toggle in the .weft file",
      def && (def.targetUri ?? def.uri).fsPath.endsWith("app.weft") && text[defLine].includes("def toggle"),
      { uri: def && (def.targetUri ?? def.uri).toString(), line: defLine });

    const sig = await vscode.commands.executeCommand("vscode.executeSignatureHelpProvider", doc.uri, pos("self.items.append(", "append(", 7), "(");
    check("code block: signature help", Boolean(sig && sig.signatures && sig.signatures.length), sig && sig.signatures?.[0]?.label);

    // Editing the .weft must refresh the shadow before the next request.
    const edit = new vscode.WorkspaceEdit();
    const endOfCode = new vscode.Position(lineOf("def remove(self, item):"), 0);
    edit.insert(doc.uri, endOfCode, "brand_new_field: int = 0\n\n");
    await vscode.workspace.applyEdit(edit);
    const refreshed = await api.docs.ensure(doc);
    check("edit: shadow content follows the .weft document",
      refreshed.version === doc.version && refreshed.doc.text.includes("brand_new_field"), refreshed.version);
    let after = [];
    for (let i = 0; i < 20; i++) {
      after = await completionsAt(doc.uri, pos("self.items.append", "self.", 5));
      if (after.includes("brand_new_field")) break;
      await sleep(500);
    }
    check("edit: new field appears in completions", after.includes("brand_new_field"), after.slice(0, 40));
    await vscode.commands.executeCommand("workbench.action.files.revert");

    // Closing: documents this test opened through the API stay alive for a
    // while after their editor closes, so exercise the close path with a file
    // opened the way a user opens it (no API reference held).
    const itemUri = vscode.Uri.file(path.join(folder, "todo_item.weft"));
    await vscode.commands.executeCommand("vscode.open", itemUri);
    const itemDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === itemUri.toString());
    const itemEntry = await api.docs.ensure(itemDoc);
    check("open: second file gets its own shadow", fs.existsSync(itemEntry.uri.fsPath), itemEntry.uri.fsPath);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    for (let i = 0; i < 20 && fs.existsSync(itemEntry.uri.fsPath); i++) await sleep(500);
    check("close: shadow file is deleted", !fs.existsSync(itemEntry.uri.fsPath), {
      path: itemEntry.uri.fsPath,
      stillTracked: api.docs.has(itemUri),
    });
  } catch (err) {
    results.error = String(err && err.stack ? err.stack : err);
  }
  results.pass = !results.error && Object.values(results.checks).every((c) => c.ok);
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
};
