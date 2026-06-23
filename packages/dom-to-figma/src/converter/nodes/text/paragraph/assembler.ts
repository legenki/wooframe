import { isElementNode, isTextNode } from "../../../dom";

// Any whitespace character, collapsed to a single space during assembly.
const WHITESPACE = /\s/;

export type ParagraphSpan = {
  /** Inclusive start index into `characters`. */
  start: number;
  /** Exclusive end index into `characters`. */
  end: number;
  /** Element whose computed style applies to this run. */
  element: Element;
};

export type AssembledParagraph = {
  characters: string;
  spans: Array<ParagraphSpan>;
};

/**
 * Flatten a block element's inline descendants into a single string plus the
 * style spans that produced it. Whitespace is collapsed the way the browser
 * renders it (runs of whitespace → one space) and the result is trimmed, so
 * indices line up with what `getClientRects()` measures on the block.
 */
export function assembleParagraph(block: Element): AssembledParagraph {
  const spans: Array<ParagraphSpan> = [];
  let characters = "";
  // Tracks whether the last emitted character was a collapsible space, so we
  // don't emit two in a row across run boundaries.
  let pendingSpace = false;

  const visit = (node: Node, styleElement: Element): void => {
    if (isTextNode(node)) {
      const raw = node.textContent ?? "";
      const spanStart = characters.length;

      const computedStyle = window.getComputedStyle(styleElement);
      const whiteSpace = computedStyle.whiteSpace;
      const preservesNewlines =
        whiteSpace === "pre" ||
        whiteSpace === "pre-wrap" ||
        whiteSpace === "pre-line" ||
        whiteSpace === "break-spaces";
      const collapsesSpaces =
        whiteSpace === "normal" ||
        whiteSpace === "nowrap" ||
        whiteSpace === "pre-line";

      for (const ch of raw) {
        if (ch === "\n" && preservesNewlines) {
          characters += "\n";
          pendingSpace = false;
          continue;
        }

        if (WHITESPACE.test(ch)) {
          if (collapsesSpaces) {
            pendingSpace = characters.length > 0 && characters.at(-1) !== "\n";
          } else {
            characters += ch;
          }
          continue;
        }

        if (pendingSpace) {
          characters += " ";
          pendingSpace = false;
        }
        characters += ch;
      }

      const spanEnd = characters.length;
      if (spanEnd > spanStart) {
        spans.push({ start: spanStart, end: spanEnd, element: styleElement });
      }
      return;
    }
    if (!isElementNode(node)) {
      return;
    }
    for (const child of Array.from(node.childNodes)) {
      // Inline children supply their own computed style; descend with the
      // child element as the new style source.
      visit(child, isElementNode(child) ? child : styleElement);
    }
  };

  for (const child of Array.from(block.childNodes)) {
    visit(child, isElementNode(child) ? child : block);
  }

  return { characters, spans };
}
