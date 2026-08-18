const fs = require("fs");
const path = require("path");

const root = __dirname;
const outDir = path.join(root, "html");

const markdownFiles = [];
walk(root);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "site.css"), stylesheet(), "utf8");

for (const file of markdownFiles) {
  const relative = path.relative(root, file);
  const outputRelative = relative.replace(/\.md$/i, ".html");
  const outputPath = path.join(outDir, outputRelative);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const markdown = fs.readFileSync(file, "utf8");
  const title = firstHeading(markdown) || path.basename(file, ".md");
  const body = markdownToHtml(markdown, path.dirname(relative));
  fs.writeFileSync(outputPath, page(title, body, relative), "utf8");
}

console.log(`Generated ${markdownFiles.length} HTML pages in ${path.relative(root, outDir)}`);

function walk(dir) {
  if (dir === outDir || dir.includes(`${path.sep}.git`)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      markdownFiles.push(full);
    }
  }
}

function firstHeading(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? stripInline(match[1]) : "";
}

function markdownToHtml(markdown, currentDir) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let inCode = false;
  let code = [];
  let inList = false;
  let inOrdered = false;
  let inParagraph = false;
  let paragraph = [];
  let inTable = false;
  let tableRows = [];

  function closeParagraph() {
    if (!inParagraph) return;
    html.push(`<p>${inline(paragraph.join(" "), currentDir)}</p>`);
    paragraph = [];
    inParagraph = false;
  }

  function closeList() {
    if (!inList) return;
    html.push(inOrdered ? "</ol>" : "</ul>");
    inList = false;
    inOrdered = false;
  }

  function closeTable() {
    if (!inTable) return;
    html.push(renderTable(tableRows, currentDir));
    tableRows = [];
    inTable = false;
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/g, "");

    if (line.startsWith("```")) {
      closeParagraph();
      closeList();
      closeTable();
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      code.push(rawLine);
      continue;
    }

    if (!line.trim()) {
      closeParagraph();
      closeList();
      closeTable();
      continue;
    }

    if (/^\|.+\|$/.test(line)) {
      closeParagraph();
      closeList();
      inTable = true;
      tableRows.push(line);
      continue;
    }

    closeTable();

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      closeParagraph();
      closeList();
      const level = heading[1].length;
      const text = inline(heading[2], currentDir);
      const id = slug(stripInline(heading[2]));
      html.push(`<h${level} id="${id}">${text}</h${level}>`);
      continue;
    }

    if (/^---+$/.test(line)) {
      closeParagraph();
      closeList();
      html.push("<hr>");
      continue;
    }

    const ordered = /^(\d+)\.\s+(.+)$/.exec(line);
    const unordered = /^[-*]\s+(.+)$/.exec(line);
    if (ordered || unordered) {
      closeParagraph();
      const isOrdered = Boolean(ordered);
      const content = ordered ? ordered[2] : unordered[1];
      if (!inList || inOrdered !== isOrdered) {
        closeList();
        html.push(isOrdered ? "<ol>" : "<ul>");
        inList = true;
        inOrdered = isOrdered;
      }
      html.push(`<li>${inline(content, currentDir)}</li>`);
      continue;
    }

    const quote = /^>\s?(.+)$/.exec(line);
    if (quote) {
      closeParagraph();
      closeList();
      html.push(`<blockquote>${inline(quote[1], currentDir)}</blockquote>`);
      continue;
    }

    closeList();
    paragraph.push(line);
    inParagraph = true;
  }

  closeParagraph();
  closeList();
  closeTable();

  return html.join("\n");
}

function renderTable(rows, currentDir) {
  const parsed = rows.map(row => row.slice(1, -1).split("|").map(cell => cell.trim()));
  if (parsed.length < 2 || !parsed[1].every(cell => /^:?-{3,}:?$/.test(cell))) {
    return parsed.map(row => `<p>${inline(row.join(" | "), currentDir)}</p>`).join("\n");
  }
  const [head, , ...body] = parsed;
  const header = `<thead><tr>${head.map(cell => `<th>${inline(cell, currentDir)}</th>`).join("")}</tr></thead>`;
  const rowsHtml = body
    .map(row => `<tr>${row.map(cell => `<td>${inline(cell, currentDir)}</td>`).join("")}</tr>`)
    .join("");
  return `<table>${header}<tbody>${rowsHtml}</tbody></table>`;
}

function inline(value, currentDir) {
  let output = escapeHtml(value);
  output = output.replace(/`([^`]+)`/g, "<code>$1</code>");
  output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, href) => {
    return `<a href="${escapeAttribute(linkTarget(href, currentDir))}">${text}</a>`;
  });
  output = output.replace(/^\[ \]\s+/, '<input type="checkbox" disabled> ');
  output = output.replace(/^\[x\]\s+/i, '<input type="checkbox" checked disabled> ');
  return output;
}

function linkTarget(href, currentDir) {
  if (/^(https?:|mailto:|#)/i.test(href)) return href;
  const [base, hash = ""] = href.split("#");
  if (!base.toLowerCase().endsWith(".md") && !base.toLowerCase().endsWith(".html")) return href;
  const absoluteTarget = path.normalize(path.join(currentDir, base));
  const htmlTarget = base.toLowerCase().endsWith(".md")
    ? absoluteTarget.replace(/\\/g, "/").replace(/\.md$/i, ".html")
    : path.join("..", absoluteTarget).replace(/\\/g, "/");
  const fromCurrentHtmlDir = path.dirname(path.join(currentDir, "current.html"));
  let relative = path.relative(fromCurrentHtmlDir, htmlTarget).replace(/\\/g, "/");
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return hash ? `${relative}#${hash}` : relative;
}

function page(title, body, sourceRelative) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${assetPrefix(sourceRelative)}site.css">
</head>
<body>
  <header class="site-header">
    <a href="${assetPrefix(sourceRelative)}Index.html">Index</a>
    <a href="${rootPrefix(sourceRelative)}CHECKLIST_APP.html">Interactive Checklist</a>
    <a href="${assetPrefix(sourceRelative)}PROJECT_PLAN.html">Project Plan</a>
  </header>
  <main class="document">
${body}
  </main>
</body>
</html>
`;
}

function assetPrefix(sourceRelative) {
  const depth = sourceRelative.split(/[\\/]/).length - 1;
  return depth === 0 ? "./" : "../".repeat(depth);
}

function rootPrefix(sourceRelative) {
  const depth = sourceRelative.split(/[\\/]/).length;
  return "../".repeat(depth);
}

function stylesheet() {
  return `* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #f7f4ee;
  color: #1e252b;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.55;
}

.site-header {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 12px max(18px, calc((100vw - 980px) / 2));
  background: rgba(247, 244, 238, 0.96);
  border-bottom: 1px solid #d8d2c8;
  backdrop-filter: blur(10px);
}

.site-header a,
.document a {
  color: #116466;
  font-weight: 700;
  text-decoration: none;
}

.site-header a:hover,
.document a:hover {
  text-decoration: underline;
}

.document {
  width: min(980px, calc(100% - 32px));
  margin: 0 auto;
  padding: 32px 0 64px;
}

h1,
h2,
h3,
h4,
h5,
h6 {
  line-height: 1.18;
  letter-spacing: 0;
}

h1 {
  margin-top: 0;
  font-size: clamp(2rem, 5vw, 3.2rem);
}

h2 {
  margin-top: 34px;
  padding-top: 10px;
  border-top: 1px solid #d8d2c8;
}

p,
li {
  font-size: 1.02rem;
}

code {
  padding: 2px 5px;
  border-radius: 4px;
  background: #eee7dc;
}

pre {
  overflow-x: auto;
  padding: 16px;
  border-radius: 8px;
  background: #1e252b;
  color: #f7f4ee;
}

pre code {
  padding: 0;
  background: transparent;
}

blockquote {
  margin: 18px 0;
  padding: 12px 16px;
  border-left: 4px solid #116466;
  background: #ffffff;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin: 18px 0;
  background: #ffffff;
}

th,
td {
  padding: 9px 10px;
  border: 1px solid #d8d2c8;
  text-align: left;
  vertical-align: top;
}

th {
  background: #e8f3f1;
}

input[type="checkbox"] {
  margin-right: 7px;
}
`;
}

function stripInline(value) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_]/g, "")
    .trim();
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, "&#039;");
}
