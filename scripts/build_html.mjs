// Stitch public/partials/*.html into public/index.html.
//
// index.html would otherwise be the one file over the 500-line cap; the
// shell declares where each rack goes via <!-- partial: name.html -->
// markers and this script inlines them. No dependencies, runs in `npm
// run build` after tsc.
import { readFile, readdir, writeFile } from "node:fs/promises";

const partialsDir = new URL("../public/partials/", import.meta.url);
const shellPath = new URL("../public/partials/_shell.html", import.meta.url);
const outputPath = new URL("../public/index.html", import.meta.url);

let shell;
try {
  shell = await readFile(shellPath, "utf8");
} catch (error) {
  // Only a missing shell means "nothing to assemble" (pre-partials
  // checkout); any other read failure must fail the build loudly.
  if (error?.code === "ENOENT") process.exit(0);
  throw error;
}

const marker = /^[ \t]*<!-- partial: ([\w.-]+\.html) -->$/gm;
const used = new Set();
const assembled = await Promise.all(
  [...shell.matchAll(marker)].map(async (match) => {
    used.add(match[1]);
    return [
      match[0],
      await readFile(new URL(match[1], partialsDir), "utf8"),
    ];
  }),
).then((replacements) =>
  replacements.reduce(
    (html, [markerText, content]) => html.replace(markerText, content.trimEnd()),
    shell,
  ),
);

const available = (await readdir(partialsDir)).filter(
  (name) => name.endsWith(".html") && name !== "_shell.html",
);
const unused = available.filter((name) => !used.has(name));
if (unused.length) {
  console.error(`build_html: partials never referenced: ${unused.join(", ")}`);
  process.exit(1);
}

await writeFile(outputPath, assembled);
console.log(
  `build_html: assembled index.html from ${used.size} partials`,
);
