import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { registerProviders } from "./forward";
import { SHADOW_DIR, VirtualDocs } from "./virtualDocs";

/** Remove shadows a previous session left behind (a crash skips deactivate). */
function sweepStaleShadows(): void {
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".weft.py")) {
        try {
          fs.unlinkSync(p);
        } catch {
          /* in use elsewhere; leave it */
        }
      }
    }
  };
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    walk(path.join(folder.uri.fsPath, SHADOW_DIR));
  }
}

export interface Api {
  docs: VirtualDocs;
}

let docs: VirtualDocs | undefined;

export function activate(context: vscode.ExtensionContext): Api {
  sweepStaleShadows();
  docs = new VirtualDocs();
  const d = docs;
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.languageId === "weft") d.drop(doc);
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
    })
  );
  registerProviders(context, d);
  return { docs: d };
}

export function deactivate(): void {
  docs?.disposeAll();
  docs = undefined;
}
