# PyWeft for VS Code

Language support for [PyWeft](https://github.com/prassanthn/PyWeft)
`.weft` components: an XML template plus a Python code block in one file.

## Features

**Python IntelliSense everywhere Python appears.** Completion, hover,
go-to-definition and signature help work in the `<code>` block, inside
`{{ }}` holes, and in every `@event="..."`, `:prop="..."`, `cond="..."`,
`each="..."` and `key="..."` value. Bare names in the template resolve to the
component's fields, methods and properties, and `<For>` loop variables are in
scope inside the loop, typed from the collection they iterate.

The analysis is done by the Python extension's language server, so you get
the same quality and settings as in a `.py` file, including your project's
interpreter and installed packages.

**Syntax highlighting** for the whole file. The `<code>` block is Python,
every expression is Python, `<If>`, `<ElseIf>`, `<Else>` and `<For>` stand
out as keywords, and capitalised component tags get their own colour.

**Snippets**: type `weft` for a full component, `if`, `ifelse`, `for`, `bind`,
`click`, `comp`, `state`, `prop`, `emit`, `oninit` and more.

**Editing basics**: bracket matching, `<!-- -->` comment toggling in the
template and `#` in the code block, indentation on Enter inside a tag, and
folding for template, code and control-flow blocks.

## Requirements

The [Python extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
with Pylance, which it installs by default. Without a Python language server
you still get highlighting and snippets.

## How it works

For each open `.weft` file the extension maintains a Python shadow file at
`.pyweft/<name>.weft.py` in your workspace: the code block as a class, plus a
method containing every template expression. Requests are translated into
that file, answered by the Python language server, and translated back.

The `.pyweft/` folder carries its own `.gitignore` so nothing in it reaches
your repository. Shadow files are removed when their `.weft` file closes and
when VS Code shuts down. The command **PyWeft: Show Virtual Python Document**
opens the shadow for the current file if you want to see what the server
sees.

## Install

Until the extension is on the Marketplace, install from a VSIX:

```bash
npm install
npm run package          # writes pyweft-<version>.vsix
code --install-extension pyweft-0.2.0.vsix
```

## Roadmap

1. **Template intelligence**: completion of sibling component tags, their
   props and events, handler names in `@click`, and go-to-definition from a
   component tag to its file.
2. **Diagnostics** from the framework's own parser via `pyweft check`, and
   Python diagnostics from the shadow file mapped back onto the `.weft`.
3. Auto-closing tags.

## Known limitations

- Helper functions defined at the top level of the code block are visible to
  the template but not, in the shadow, to other methods. Imports and
  constants are.
- A `.weft` file outside any workspace folder gets its shadow next to itself.

## Development

```bash
npm install
npm test                 # grammar scopes + virtual document unit tests
npm run test:e2e         # opens VS Code with Pylance and drives the providers
```

Press F5 in VS Code to launch an Extension Development Host with the PyWeft
todo example open (expects the framework checked out as a sibling folder
named `python_framework`). Use *Developer: Inspect Editor Tokens and Scopes*
to see what the grammar assigns.

## License

MIT
