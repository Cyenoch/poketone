// The text the game's source can display: string literals, template-literal text and JSX text
// (escapes decoded), never comments. One extraction for the font build (game_text.py)
// and the glyph tests, on TypeScript's own scanner so `//` inside a string, regex literals and
// nested templates are tokens, not guesses.
//   node scripts/fonts/source-text.mjs   # prints {"chrome": "...", "content": "..."}
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { LanguageVariant, SyntaxKind as K } from "typescript/unstable/ast";
import { createScanner } from "typescript/unstable/ast/scanner";

// After these a `/` divides and a `<` compares; after anything else they start a regex / JSX.
const VALUE_END = new Set([
  K.Identifier,
  K.ThisKeyword,
  K.SuperKeyword,
  K.TrueKeyword,
  K.FalseKeyword,
  K.NullKeyword,
  K.NumericLiteral,
  K.BigIntLiteral,
  K.StringLiteral,
  K.NoSubstitutionTemplateLiteral,
  K.TemplateTail,
  K.RegularExpressionLiteral,
  K.CloseParenToken,
  K.CloseBracketToken,
  K.CloseBraceToken,
  K.PlusPlusToken,
  K.MinusMinusToken,
  K.ExclamationToken,
]);

/** The displayable text pieces of one TypeScript / TSX source. */
export function displayText(source, jsx = false) {
  const scanner = createScanner(true, jsx ? LanguageVariant.JSX : LanguageVariant.Standard, source);
  const pieces = [];
  let previous;

  /** Tokens until the `}` that closes the current `{` (or the end): templates nest inside. */
  function code(untilCloseBrace) {
    let depth = 0;
    const templates = []; // brace depth at which each open template substitution closes
    for (let token = scanner.scan(); token !== K.EndOfFile; token = scanner.scan()) {
      if (token === K.CloseBraceToken && templates.at(-1) === depth) {
        token = scanner.reScanTemplateToken(false);
        pieces.push(scanner.getTokenValue());
        if (token === K.TemplateTail) templates.pop();
      } else if (token === K.CloseBraceToken) {
        if (depth === 0 && untilCloseBrace) return;
        depth--;
      } else if (token === K.OpenBraceToken) depth++;
      else if (token === K.TemplateHead) {
        pieces.push(scanner.getTokenValue());
        templates.push(depth);
      } else if (token === K.StringLiteral || token === K.NoSubstitutionTemplateLiteral)
        pieces.push(scanner.getTokenValue());
      else if ((token === K.SlashToken || token === K.SlashEqualsToken) && !VALUE_END.has(previous))
        token = scanner.reScanSlashToken();
      else if (jsx && token === K.LessThanToken && !VALUE_END.has(previous)) {
        element();
        token = K.CloseParenToken; // a JSX element ends an expression, like a value
      }
      previous = token;
    }
  }

  /** A JSX element whose `<` was just scanned: its attribute strings and children's text. */
  function element() {
    let token = scanner.scan();
    if (token === K.Identifier) scanner.scanJsxIdentifier();
    for (token = scanner.scan(); token !== K.GreaterThanToken; token = scanner.scan()) {
      if (token === K.EndOfFile) return;
      if (token === K.SlashToken) {
        scanner.scan(); // the `>` of a self-closing tag
        return;
      }
      if (token === K.Identifier) scanner.scanJsxIdentifier();
      else if (token === K.EqualsToken) {
        if (scanner.scanJsxAttributeValue() === K.StringLiteral)
          pieces.push(scanner.getTokenValue());
        else code(true); // `={expression}`
      } else if (token === K.OpenBraceToken) code(true); // `{...spread}`
    }
    for (token = scanner.scanJsxToken(); token !== K.EndOfFile; token = scanner.scanJsxToken()) {
      if (token === K.JsxText) pieces.push(scanner.getTokenValue());
      else if (token === K.OpenBraceToken) code(true);
      else if (token === K.LessThanToken) element();
      else if (token === K.LessThanSlashToken) {
        while (token !== K.GreaterThanToken && token !== K.EndOfFile) token = scanner.scan();
        return;
      }
    }
  }

  code(false);
  return pieces;
}

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const HARBOR = fileURLToPath(new URL("../../services/harbor/", import.meta.url));

/** Game text and Harbor's room errors, which the multiplayer window displays verbatim. */
export function sourceTexts() {
  return [SRC, HARBOR]
    .flatMap((root) => readdirSync(root, { recursive: true, withFileTypes: true }))
    .filter(
      (entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts"),
    )
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return {
        path,
        text: displayText(readFileSync(path, "utf8"), path.endsWith(".tsx")).join(""),
      };
    });
}

/** Chrome: what the shell, the lobby and the windows over it are written in (src/ui/**, src/*);
 *  content: the rest of the game's text (docs/fonts-paging-design.md). */
export function chromeAndContent() {
  let chrome = "",
    content = "";
  for (const { path, text } of sourceTexts()) {
    const parts = relative(SRC, path).split(sep);
    if (parts[0] === "ui" || parts.length === 1) chrome += text;
    else content += text;
  }
  return { chrome, content };
}

if (import.meta.url === `file://${process.argv[1]}`)
  process.stdout.write(JSON.stringify(chromeAndContent()));
