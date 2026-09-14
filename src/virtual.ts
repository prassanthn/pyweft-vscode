// Builds the virtual Python document for a .weft file.
//
// Pylance does the actual analysis. Our job is to give it something it can
// analyse that preserves every character the user might put a cursor on,
// with a position map back to the .weft file. The shape:
//
//     from typing import Any
//     from pyweft import Component
//
//     class _Weft(Component):
//         <the <code> block, shifted right by four columns>
//
//         def _pyweft_template(self) -> None:
//             event: Any = None
//             count = self.count          # one alias per top-level name
//             (count)                     # every {{ }} / directive expression
//             for item in (items):        # <For each="item in items">
//                 (item['id'])            # key= and body expressions
//             return None
//
// The aliases exist because a bare name in a template resolves to a
// component attribute, which is not how Python scoping works; aliasing gives
// Pylance the same view the renderer's Scope has, with types intact.
//
// This module has no VS Code dependency so it can be unit-tested with node.

export interface Pos {
  line: number;
  character: number;
}

export interface Segment {
  vLine: number;
  vCol: number;
  wLine: number;
  wCol: number;
  length: number;
  kind: "code" | "expr";
}

export interface VirtualDoc {
  text: string;
  segments: Segment[];
  /**
   * Bare template names are aliased (`count = self.count`) so they resolve.
   * Hover and go-to-definition on such a name would land on the alias line,
   * which maps nowhere; this gives the virtual position of the `count` in
   * `self.count` so those requests can be redirected to the real member.
   */
  aliases: Map<string, Pos>;
  /**
   * At runtime every top-level name in the code block is a global for the
   * methods as well as a class attribute, so imports and constants are also
   * emitted, unmapped, at module level. When the server points at one of
   * those duplicate lines, this gives the class-copy line and column shift
   * that maps back to the .weft file.
   */
  moduleDup: Map<number, { line: number; shift: number }>;
  /** .weft position -> virtual position, or null when not inside Python. */
  toVirtual(p: Pos): Pos | null;
  /** virtual position -> .weft position, or null for generated scaffolding. */
  toWeft(p: Pos): Pos | null;
}

// Same slicing rules as pyweft.parser.split_source: the code block is cut
// out by greedy string scanning first, then the template is located.
const CODE_RE = /<code\s*>([\s\S]*)<\/code\s*>/;
const STYLE_RE = /<style\s*>([\s\S]*)<\/style\s*>/;
const TEMPLATE_RE = /<template\s*>([\s\S]*)<\/template\s*>/;

/** Replace a matched block with spaces so offsets elsewhere are unchanged. */
function blank(src: string, m: RegExpExecArray): string {
  return src.slice(0, m.index) + m[0].replace(/[^\n]/g, " ") + src.slice(m.index + m[0].length);
}

const TAG_RE =
  /<!--[\s\S]*?-->|<(\/?)([A-Za-z_][\w.\-:]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/g;
const ATTR_RE = /([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;
const INTERP_RE = /\{\{([\s\S]*?)\}\}/g;
const EACH_RE = /^(\s*)([A-Za-z_]\w*)(\s+in\s+)([\s\S]+)$/;
const IDENT_RE = /^[A-Za-z_]\w*$/;

class LineIndex {
  private readonly starts: number[] = [0];

  constructor(text: string) {
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\n") this.starts.push(i + 1);
    }
  }

  pos(offset: number): Pos {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo, character: offset - this.starts[lo] };
  }
}

class Builder {
  readonly lines: string[] = [];
  readonly segments: Segment[] = [];

  emit(line: string): void {
    this.lines.push(line);
  }

  /** Emit `text` (which may span lines) so every character maps back. */
  emitMapped(
    indent: number,
    prefix: string,
    text: string,
    start: Pos,
    suffix: string,
    kind: Segment["kind"]
  ): void {
    const parts = text.split("\n");
    parts.forEach((part, i) => {
      const pre = i === 0 ? " ".repeat(indent) + prefix : "";
      const post = i === parts.length - 1 ? suffix : "";
      this.segments.push({
        vLine: this.lines.length,
        vCol: pre.length,
        wLine: start.line + i,
        wCol: i === 0 ? start.character : 0,
        length: part.length,
        kind,
      });
      this.lines.push(pre + part + post);
    });
  }
}

/** Names a template expression can see: top-level fields, methods, imports. */
function collectNames(line: string, minIndent: number, into: Set<string>): void {
  const indent = /^[ \t]*/.exec(line)![0].length;
  if (indent !== minIndent) return;
  const s = line.trim();
  let m: RegExpExecArray | null;
  if ((m = /^(?:async\s+)?def\s+([A-Za-z_]\w*)/.exec(s))) into.add(m[1]);
  else if ((m = /^class\s+([A-Za-z_]\w*)/.exec(s))) into.add(m[1]);
  else if ((m = /^import\s+([\w.]+)(?:\s+as\s+(\w+))?/.exec(s))) into.add(m[2] ?? m[1].split(".")[0]);
  else if ((m = /^from\s+\S+\s+import\s+(.+)$/.exec(s))) {
    for (const part of m[1].replace(/[()]/g, "").split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name && IDENT_RE.test(name)) into.add(name);
    }
  } else if ((m = /^([A-Za-z_]\w*)\s*[:=]/.exec(s)) && !/^(?:if|for|while|with|try|else|elif|except|finally|return|lambda|class|def)\b/.test(s)) {
    into.add(m[1]);
  }
}

/**
 * Split code-block lines into top-level statements. `member` blocks are
 * function definitions (with any decorators); everything else is a plain
 * statement that also needs to exist at module level.
 */
function topLevelBlocks(codeLines: string[], minIndent: number): { start: number; end: number; member: boolean }[] {
  const blocks: { start: number; end: number; member: boolean }[] = [];
  let depth = 0;
  let afterDecorator = false;
  const strip = (l: string) => l.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, "").replace(/#.*$/, "");
  for (let i = 0; i < codeLines.length; i++) {
    const line = codeLines[i];
    const indent = /^[ \t]*/.exec(line)![0].length;
    const s = line.trim();
    const continues =
      depth > 0 ||
      afterDecorator ||
      !s ||
      indent > minIndent ||
      /^[)\]}]/.test(s) ||
      /^(else|elif|except|finally)\b/.test(s);
    if (!continues || !blocks.length) {
      blocks.push({ start: i, end: i + 1, member: false });
    } else {
      blocks[blocks.length - 1].end = i + 1;
    }
    if (s) afterDecorator = s.startsWith("@");
    for (const ch of strip(line)) {
      if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) depth = Math.max(0, depth - 1);
    }
  }
  for (const b of blocks) {
    const first = codeLines.slice(b.start, b.end).map((l) => l.trim()).find((l) => l && !l.startsWith("@"));
    b.member = Boolean(first && /^(async\s+)?def\b/.test(first));
  }
  return blocks;
}

interface Attr {
  name: string;
  value: string;
  offset: number; // offset of the value's first character in the source
}

function parseAttrs(attrText: string, attrStart: number): Attr[] {
  const out: Attr[] = [];
  for (const a of attrText.matchAll(ATTR_RE)) {
    const value = a[2] ?? a[3];
    if (value === undefined) continue;
    // the match ends with the closing quote, so the value starts just before it
    const offset = attrStart + a.index! + a[0].length - value.length - 1;
    out.push({ name: a[1], value, offset });
  }
  return out;
}

function isExpressionAttr(name: string): boolean {
  return (
    name.startsWith("@") ||
    name.startsWith("py-at-") ||
    name.startsWith(":") ||
    name.startsWith("py-colon-") ||
    name === "cond" ||
    name === "key"
  );
}

function walkTemplate(content: string, contentOffset: number, b: Builder, idx: LineIndex): void {
  let indent = 8;
  const stack: { name: string; isFor: boolean; bodyStart: number }[] = [];

  const closeFor = (bodyStart: number) => {
    if (b.lines.length === bodyStart) b.emit(" ".repeat(indent) + "pass");
    indent -= 4;
  };

  const interpolations = (text: string, textOffset: number) => {
    for (const m of text.matchAll(INTERP_RE)) {
      const at = textOffset + m.index! + 2;
      b.emitMapped(indent, "(", m[1], idx.pos(at), ")", "expr");
    }
  };

  let last = 0;
  for (const m of content.matchAll(TAG_RE)) {
    interpolations(content.slice(last, m.index), contentOffset + last);
    last = m.index! + m[0].length;
    if (m[0].startsWith("<!--")) continue;

    const [whole, close, name, attrText, selfClose] = m;
    if (close) {
      while (stack.length) {
        const top = stack.pop()!;
        if (top.isFor) closeFor(top.bodyStart);
        if (top.name === name) break;
      }
      continue;
    }

    const attrStart = contentOffset + m.index! + 1 + close.length + name.length;
    const attrs = parseAttrs(attrText, attrStart);
    const isFor = name === "For";
    let bodyStart = b.lines.length;

    if (isFor) {
      const each = attrs.find((a) => a.name === "each");
      const em = each && EACH_RE.exec(each.value);
      if (each && em) {
        const iterOffset = each.offset + em[1].length + em[2].length + em[3].length;
        b.emitMapped(indent, `for ${em[2]} in (`, em[4], idx.pos(iterOffset), "):", "expr");
      } else {
        b.emit(" ".repeat(indent) + "for _ in ():");
      }
      indent += 4;
      bodyStart = b.lines.length;
      const index = attrs.find((a) => a.name === "index");
      if (index && IDENT_RE.test(index.value.trim())) {
        b.emit(" ".repeat(indent) + `${index.value.trim()} = 0`);
      }
    }

    for (const a of attrs) {
      if (isFor && (a.name === "each" || a.name === "index")) continue;
      if (isExpressionAttr(a.name)) {
        b.emitMapped(indent, "(", a.value, idx.pos(a.offset), ")", "expr");
      } else {
        interpolations(a.value, a.offset);
      }
    }

    if (selfClose) {
      if (isFor) closeFor(bodyStart);
    } else {
      stack.push({ name, isFor, bodyStart });
    }
    void whole;
  }
  interpolations(content.slice(last), contentOffset + last);
  while (stack.length) {
    const top = stack.pop()!;
    if (top.isFor) closeFor(top.bodyStart);
  }
}

export function buildVirtual(src: string): VirtualDoc {
  const idx = new LineIndex(src);
  const b = new Builder();

  // Same slicing order as the framework: code out first, then style, then
  // the template is located in what remains.
  const code = CODE_RE.exec(src);
  let blanked = code ? blank(src, code) : src;
  const style = STYLE_RE.exec(blanked);
  if (style) blanked = blank(blanked, style);
  const tmpl = TEMPLATE_RE.exec(blanked);

  b.emit("from typing import Any");
  b.emit("from pyweft import Component");
  b.emit("");

  const names = new Set<string>();
  const moduleDup = new Map<number, { line: number; shift: number }>();
  const codeLines = code ? code[1].split("\n") : [];
  const indents = codeLines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length);
  const minIndent = indents.length ? Math.min(...indents) : 0;
  const blocks = topLevelBlocks(codeLines, minIndent);

  // Module-level copy of the non-method statements (unmapped scaffolding).
  const moduleLineOf = new Map<number, number>();
  for (const blk of blocks) {
    if (blk.member) continue;
    for (let i = blk.start; i < blk.end; i++) {
      moduleLineOf.set(i, b.lines.length);
      b.emit(codeLines[i].slice(minIndent));
    }
  }
  b.emit("");
  b.emit("class _Weft(Component):");

  if (code) {
    let offset = code.index + code[0].indexOf(">") + 1;
    codeLines.forEach((line, i) => {
      if (line.trim()) {
        const mod = moduleLineOf.get(i);
        if (mod !== undefined) moduleDup.set(mod, { line: b.lines.length, shift: 4 + minIndent });
        b.emitMapped(4, "", line, idx.pos(offset), "", "code");
        collectNames(line, minIndent, names);
      } else {
        b.emit("");
      }
      offset += line.length + 1;
    });
  }

  b.emit("");
  b.emit("    def _pyweft_template(self) -> None:");
  b.emit("        event: Any = None");
  const aliases = new Map<string, Pos>();
  for (const name of ["emit", "state_has_changed", ...names]) {
    const line = `        ${name} = self.${name}`;
    aliases.set(name, { line: b.lines.length, character: line.length - name.length });
    b.emit(line);
  }
  if (tmpl) {
    const contentOffset = tmpl.index + tmpl[0].indexOf(">") + 1;
    walkTemplate(tmpl[1], contentOffset, b, idx);
  }
  b.emit("        return None");
  b.emit("");

  const segments = b.segments;
  return {
    text: b.lines.join("\n"),
    segments,
    aliases,
    moduleDup,
    toVirtual(p) {
      for (const s of segments) {
        if (s.wLine === p.line && p.character >= s.wCol && p.character <= s.wCol + s.length) {
          return { line: s.vLine, character: s.vCol + (p.character - s.wCol) };
        }
      }
      return null;
    },
    toWeft(p) {
      for (const s of segments) {
        if (s.vLine === p.line && p.character >= s.vCol && p.character <= s.vCol + s.length) {
          return { line: s.wLine, character: s.wCol + (p.character - s.vCol) };
        }
      }
      return null;
    },
  };
}
