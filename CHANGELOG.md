# Changelog

## 0.2.2

- Inline statement handlers (`@click="count += 1"`, PyWeft 0.0.2) are
  emitted as statements in the shadow document, so they get completions
  instead of a syntax error.

## 0.2.1

- `<style>` blocks (component-scoped CSS, PyWeft 0.0.2) are highlighted as
  CSS and folded; `style` snippet.
- The shadow Python document ignores `<style>` blocks.

## 0.2.0

- Python IntelliSense in `.weft` files: completion, hover, go-to-definition
  and signature help in the `<code>` block and in every template expression,
  provided by the installed Python language server through a per-file shadow
  document under `.pyweft/`.
- Bare template names resolve to component members; `<For>` loop variables
  are in scope and typed.
- Command **PyWeft: Show Virtual Python Document**.
- Requires the Python extension.

## 0.1.0

- Registers the `weft` language for `.weft` files.
- Syntax highlighting: XML template with `{{ }}` interpolation, `@event` and
  `:binding` directives, `<If>/<ElseIf>/<Else>/<For>` control flow, component
  tags, and the `<code>` block highlighted as Python.
- Snippets for component skeletons, control flow, directives, state fields,
  handlers, computed properties and lifecycle hooks.
- Bracket matching, comment toggling, indentation on Enter, and folding for
  the template, code and control-flow blocks.
