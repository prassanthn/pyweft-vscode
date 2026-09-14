"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const forward_1 = require("./forward");
const virtualDocs_1 = require("./virtualDocs");
/** Remove shadows a previous session left behind (a crash skips deactivate). */
function sweepStaleShadows() {
    const walk = (dir) => {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const e of entries) {
            const p = path.join(dir, e.name);
            if (e.isDirectory())
                walk(p);
            else if (e.name.endsWith(".weft.py")) {
                try {
                    fs.unlinkSync(p);
                }
                catch {
                    /* in use elsewhere; leave it */
                }
            }
        }
    };
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        walk(path.join(folder.uri.fsPath, virtualDocs_1.SHADOW_DIR));
    }
}
let docs;
function activate(context) {
    sweepStaleShadows();
    docs = new virtualDocs_1.VirtualDocs();
    const d = docs;
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((doc) => {
        if (doc.languageId === "weft")
            d.drop(doc);
    }), 
    // Debugging aid: see exactly what the Python server is being asked about.
    vscode.commands.registerCommand("pyweft.showVirtualPython", async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== "weft") {
            vscode.window.showInformationMessage("Open a .weft file first.");
            return;
        }
        const entry = await d.ensure(editor.document);
        const doc = await vscode.workspace.openTextDocument(entry.uri);
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
    }));
    (0, forward_1.registerProviders)(context, d);
    return { docs: d };
}
function deactivate() {
    docs?.disposeAll();
    docs = undefined;
}
//# sourceMappingURL=extension.js.map