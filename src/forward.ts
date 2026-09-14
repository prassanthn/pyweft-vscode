// Language feature providers for .weft files. Each one translates the
// position into the virtual Python document, asks whatever Python language
// server is installed (Pylance, normally) via the built-in execute*Provider
// commands, and translates positions in the answer back.

import * as vscode from "vscode";
import { Pos } from "./virtual";
import { Entry, VirtualDocs } from "./virtualDocs";

const toVs = (p: Pos) => new vscode.Position(p.line, p.character);
const fromVs = (p: vscode.Position): Pos => ({ line: p.line, character: p.character });

function mapRange(entry: Entry, r: vscode.Range): vscode.Range | undefined {
  const s = entry.doc.toWeft(fromVs(r.start));
  const e = entry.doc.toWeft(fromVs(r.end));
  if (s && e) return new vscode.Range(toVs(s), toVs(e));
  // A hit on the module-level duplicate of a code-block statement: go via
  // the class copy, which is the mapped one.
  const dup = entry.doc.moduleDup.get(r.start.line);
  if (dup && r.end.line === r.start.line) {
    const shifted = new vscode.Range(dup.line, r.start.character + dup.shift, dup.line, r.end.character + dup.shift);
    return mapRange(entry, shifted);
  }
  return undefined;
}

async function locate(docs: VirtualDocs, document: vscode.TextDocument, position: vscode.Position) {
  const entry = await docs.ensure(document);
  const vp = entry.doc.toVirtual(fromVs(position));
  return vp ? { entry, vpos: toVs(vp) } : undefined;
}

/**
 * For hover and definition: if the cursor is on a bare name that the virtual
 * document aliases, point at the `self.<name>` in the alias line instead so
 * the answer describes the real field, method or property.
 */
function throughAlias(entry: Entry, vpos: vscode.Position): vscode.Position {
  const line = entry.doc.text.split("\n")[vpos.line] ?? "";
  const re = /[A-Za-z_]\w*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index <= vpos.character && vpos.character <= m.index + m[0].length) {
      const target = entry.doc.aliases.get(m[0]);
      const isAttribute = line[m.index - 1] === ".";
      return target && !isAttribute ? toVs(target) : vpos;
    }
    if (m.index > vpos.character) break;
  }
  return vpos;
}

export function registerProviders(context: vscode.ExtensionContext, docs: VirtualDocs): void {
  const selector: vscode.DocumentSelector = { language: "weft" };

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      {
        async provideCompletionItems(document, position, _token, ctx) {
          const at = await locate(docs, document, position);
          if (!at) return undefined;
          const list = await vscode.commands.executeCommand<vscode.CompletionList>(
            "vscode.executeCompletionItemProvider",
            at.entry.uri,
            at.vpos,
            ctx.triggerCharacter,
            30
          );
          if (!list) return undefined;
          for (const item of list.items) {
            // Auto-import edits target the top of the virtual file; there is
            // nowhere sensible to put them in a .weft file.
            item.additionalTextEdits = undefined;
            if (item.range instanceof vscode.Range) {
              item.range = mapRange(at.entry, item.range);
            } else if (item.range) {
              const inserting = mapRange(at.entry, item.range.inserting);
              const replacing = mapRange(at.entry, item.range.replacing);
              item.range = inserting && replacing ? { inserting, replacing } : undefined;
            }
          }
          return new vscode.CompletionList(list.items, list.isIncomplete);
        },
      },
      ".",
      "[",
      '"',
      "'"
    ),

    vscode.languages.registerHoverProvider(selector, {
      async provideHover(document, position) {
        const at = await locate(docs, document, position);
        if (!at) return undefined;
        const target = throughAlias(at.entry, at.vpos);
        const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
          "vscode.executeHoverProvider",
          at.entry.uri,
          target
        );
        const h = hovers?.[0];
        if (!h) return undefined;
        // A redirected hover's range describes the alias line; let VS Code
        // highlight the word under the cursor instead.
        const range = target === at.vpos && h.range ? mapRange(at.entry, h.range) : undefined;
        return new vscode.Hover(h.contents, range);
      },
    }),

    vscode.languages.registerDefinitionProvider(selector, {
      async provideDefinition(document, position) {
        const at = await locate(docs, document, position);
        if (!at) return undefined;
        const found = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
          "vscode.executeDefinitionProvider",
          at.entry.uri,
          throughAlias(at.entry, at.vpos)
        );
        const out: vscode.Location[] = [];
        for (const loc of found ?? []) {
          const uri = "targetUri" in loc ? loc.targetUri : loc.uri;
          const range = "targetUri" in loc ? loc.targetSelectionRange ?? loc.targetRange : loc.range;
          if (uri.toString() === at.entry.uri.toString()) {
            const mapped = mapRange(at.entry, range);
            if (mapped) out.push(new vscode.Location(document.uri, mapped));
          } else {
            out.push(new vscode.Location(uri, range));
          }
        }
        return out;
      },
    }),

    vscode.languages.registerSignatureHelpProvider(
      selector,
      {
        async provideSignatureHelp(document, position, _token, ctx) {
          const at = await locate(docs, document, position);
          if (!at) return undefined;
          return vscode.commands.executeCommand<vscode.SignatureHelp>(
            "vscode.executeSignatureHelpProvider",
            at.entry.uri,
            at.vpos,
            ctx.triggerCharacter
          );
        },
      },
      "(",
      ","
    )
  );
}
