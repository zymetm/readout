/* A small reader for styles.css: the rules (selector plus the properties it
 * sets, in order), with comments dropped and nested at-rules such as @media
 * walked into. Used by the CSS lint gate and its own tests. */

export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/* Splits the declarations of one rule body on `;`, keeping `;` that sit
 * inside parentheses or quotes (url(data:...;base64,...), "a;b"). */
function declarations(body) {
  const out = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (const ch of body) {
    if (quote) { if (ch === quote) quote = ''; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ';' && depth === 0 && !quote) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((d) => d.trim()).filter(Boolean);
}

/* Returns [{ selector, line, props: [name, ...] }] for every rule with a body. */
export function readRules(rawCss) {
  const css = stripComments(rawCss);
  const rules = [];
  const stack = [];
  let start = 0;
  let line = 1;
  let selStart = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '\n') line++;
    if (ch === '{') {
      const selector = css.slice(selStart, i).trim();
      stack.push({ selector, open: i, line, atRule: selector.startsWith('@') && !/^@(font-face|page)/.test(selector) });
      selStart = i + 1;
    } else if (ch === '}') {
      const top = stack.pop();
      if (top && !top.atRule) {
        const body = css.slice(top.open + 1, i);
        const props = declarations(body)
          .map((d) => { const c = d.indexOf(':'); return c < 0 ? '' : d.slice(0, c).trim().toLowerCase(); })
          .filter(Boolean);
        rules.push({ selector: top.selector, line: top.line, endLine: line, props });
      }
      selStart = i + 1;
    } else if (ch === ';' && stack.length === 0) {
      selStart = i + 1;
    }
  }
  void start;
  return rules;
}

/* Every property that appears more than once in one rule. */
export function duplicateProperties(rawCss) {
  const found = [];
  for (const r of readRules(rawCss)) {
    const seen = new Set();
    const dup = new Set();
    for (const p of r.props) { if (p.startsWith('--')) continue; if (seen.has(p)) dup.add(p); seen.add(p); }
    for (const p of dup) found.push({ selector: r.selector, line: r.line, property: p });
  }
  return found;
}
