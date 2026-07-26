// @ts-check
// Markdown → model extraction for doc-snippet-validate. Kept separate from `cli.mjs` so it can be
// imported and tested without running the CLI.

/**
 * A heading (or bold line) whose leading content is a backticked path ending in .yaml/.yml.
 * Matching the *heading* rather than any inline code keeps prose mentions of a filename from
 * being mistaken for a declaration.
 */
const FILE_HEADING = /^\s{0,3}(?:#{1,6}\s+|\*\*)\s*`([^`]+\.ya?ml)`/;

/**
 * Extract fenced yaml blocks together with the file each one claims to be.
 *
 * A block is "named" when the line immediately above it (blank lines aside) is a heading naming a
 * `.yaml` file — the convention the modeling prompts already use:
 *
 *     #### `.blueprint/repair-jobs/domain.yaml`
 *
 *     ```yaml
 *     ...
 *     ```
 *
 * Unnamed blocks are illustrative fragments, not documents; they are counted and skipped rather
 * than guessed at, because validating a fragment against a whole-document schema produces
 * failures that are noise.
 *
 * @param {string} markdown
 * @returns {{ blocks: Array<{path: string, body: string, line: number}>, unnamed: number }}
 */
export function extractBlocks(markdown) {
  const lines = markdown.split(/\r?\n/);
  const blocks = [];
  let unnamed = 0;
  let pendingPath = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const heading = FILE_HEADING.exec(line);
    if (heading) {
      pendingPath = heading[1];
      continue;
    }

    const fence = /^\s*```\s*ya?ml\s*$/.exec(line);
    if (!fence) {
      // A non-blank line between the heading and its fence breaks the association — otherwise a
      // filename mentioned pages earlier would capture an unrelated block.
      if (line.trim() !== "" && pendingPath !== null) pendingPath = null;
      continue;
    }

    let start = i + 1;
    let end = start;
    while (end < lines.length && !/^\s*```\s*$/.test(lines[end])) end++;

    // In-block opt-in: `# file: .blueprint/domain.yaml` as the block's first line. Guides that
    // organise fences under conceptual headings ("Causal chain pattern") rather than filenames
    // have no way to declare a document otherwise — this lets a fragment opt in without the
    // surrounding prose changing shape. The marker line is not part of the YAML written out.
    const marker = start < end ? /^\s*#\s*file:\s*(\S+\.ya?ml)\s*$/.exec(lines[start]) : null;
    if (marker) {
      pendingPath = marker[1];
      start++;
    }

    const body = lines.slice(start, end).join("\n");
    i = end;

    if (pendingPath === null) unnamed++;
    // 1-indexed: the number an editor shows for the block's first content line.
    else blocks.push({ path: pendingPath, body, line: start + 1 });
    pendingPath = null;
  }

  return { blocks, unnamed };
}

/**
 * `.blueprint/repair-jobs/domain.yaml` → `repair-jobs/domain.yaml`.
 * The extraction directory IS the model root, so the `.blueprint/` prefix must not be recreated.
 *
 * @param {string} declaredPath
 */
export function modelRelativePath(declaredPath) {
  return declaredPath.replace(/\\/g, "/").replace(/^\.?\/?\.blueprint\//, "").replace(/^\.?\//, "");
}
