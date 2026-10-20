// Pure helper: group positioned text items into lines. Shared by the renderer and the Office writers.
/** Group positioned items into lines (same baseline, left to right). */
export function linesOf(items) {
  const sorted = [...items].filter((i) => i.str.trim() !== "" || i.eol).sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= Math.max(2, it.size * 0.4)) {
      const gap = it.x - last.xEnd;
      last.text += (gap > it.size * 0.25 && !last.text.endsWith(" ") && !it.str.startsWith(" ") ? " " : "") + it.str;
      last.xEnd = Math.max(last.xEnd, it.x + it.w);
      last.items.push(it);
    } else lines.push({ y: it.y, x: it.x, xEnd: it.x + it.w, size: it.size, bold: it.bold, text: it.str, items: [it] });
  }
  return lines;
}

