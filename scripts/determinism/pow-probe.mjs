import { parse } from "acorn";

/** Lower only the diagnostic bundle's exponentiation, including nested expressions. */
export function lowerPowers(code) {
  const ast = parse(code, { ecmaVersion: "latest", sourceType: "module" });
  function render(node) {
    if (node.type === "BinaryExpression" && node.operator === "**")
      return `Math.pow(${render(node.left)}, ${render(node.right)})`;
    const children = Object.values(node)
      .flatMap((value) =>
        Array.isArray(value) ? value.filter((item) => item?.type) : value?.type ? [value] : [],
      )
      .sort((a, b) => a.start - b.start);
    let cursor = node.start;
    let result = "";
    for (const child of children) {
      if (child.start < cursor) continue;
      result += code.slice(cursor, child.start) + render(child);
      cursor = child.end;
    }
    return result + code.slice(cursor, node.end);
  }
  return render(ast);
}
