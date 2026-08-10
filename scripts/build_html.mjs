// Stitch public/partials/*.html into public/index.html.
//
// index.html would otherwise be the one file over the 500-line cap; the
// shell declares where each rack goes via <!-- partial: name.html -->
// markers and this script inlines them. No dependencies, runs in `npm
// run build` after tsc. Pass --watch to reassemble on partial edits
// (plain fs.watch on the flat partials directory — portable, unlike
// node's --watch-path which is unsupported on Linux).
import { watch } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";

const partialsDir = new URL("../public/partials/", import.meta.url);
const shellPath = new URL("../public/partials/_shell.html", import.meta.url);
const outputPath = new URL("../public/index.html", import.meta.url);

async function assemble() {
  let shell;
  try {
    shell = await readFile(shellPath, "utf8");
  } catch (error) {
    // Only a missing shell means "nothing to assemble" (pre-partials
    // checkout); any other read failure must fail the build loudly.
    if (error?.code === "ENOENT") return false;
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
    throw new Error(
      `build_html: partials never referenced: ${unused.join(", ")}`,
    );
  }

  await writeFile(outputPath, assembled);
  console.log(`build_html: assembled index.html from ${used.size} partials`);
  return true;
}

if (process.argv.includes("--watch")) {
  await assemble();
  let timer = null;
  watch(partialsDir, () => {
    // Editors fire bursts of events per save; coalesce them.
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      assemble().catch((error) => console.error(String(error)));
    }, 50);
  });
  console.log("build_html: watching public/partials/ …");
} else {
  try {
    const assembled = await assemble();
    if (!assembled) process.exit(0);
  } catch (error) {
    console.error(String(error));
    process.exit(1);
  }
}
