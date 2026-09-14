# PyWeft for VS Code

Language support for [PyWeft](https://github.com/prassanthn/PyWeft)
`.weft` components: an XML template plus a Python code block in one file.

## What you get today

- **Syntax highlighting** for the whole file. The `<code>` block is
  highlighted as Python, `{{ }}` holes and every `@event="..."`, `:prop="..."`,
  `cond="..."`, `each="..."` and `key="..."` value are highlighted as Python
  expressions, and `<If>`, `<ElseIf>`, `<Else>` and `<For>` stand out as
  keywords. Capitalised component tags get their own colour.
- **Snippets**: type `weft` for a full component, `if`, `ifelse`, `for`,
  `bind`, `click`, `comp`, `state`, `prop`, `emit`, `oninit` and more.
- **Editing basics**: bracket matching, `<!-- -->` comment toggling in the
  template and `#` in the code block, indentation on Enter inside a tag, and
  folding for template, code and control-flow blocks.

## Install

Until the extension is on the Marketplace, install from a VSIX:

```bash
npm install
npm run package          # writes pyweft-<version>.vsix
code --install-extension pyweft-0.1.0.vsix
```

## Roadmap

1. **Python IntelliSense in `<code>` and expressions** by mapping each `.weft`
   file onto a virtual Python document and forwarding completion, hover and
   go-to-definition to Pylance.
2. **Template intelligence**: completion of sibling component tags, their
   props and events, handler names in `@click`, and go-to-definition from a
   component tag to its file.
3. **Diagnostics** from the framework's own parser via `pyweft check`.

## Development

```bash
npm install
npm test                 # tokenises sample files and checks the scopes
```

Press F5 in VS Code to launch an Extension Development Host with the PyWeft
todo example open (expects the framework checked out as a sibling folder
named `python_framework`). Use *Developer: Inspect Editor Tokens and Scopes*
to see what the grammar assigns.

## License

MIT
