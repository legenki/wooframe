import { TRANSPARENT_COLOR_VALUES } from "./styles/color";

export type ElementKind =
  | "skip"
  | "group"
  | "frame"
  | "vector"
  | "image"
  | "text"
  | "text-paragraph"
  | "form-with-placeholder";

export function defaultClassify(element: Element): ElementKind {
  if (isNonVisualElement(element)) {
    return "skip";
  }
  if (isHiddenElement(element)) {
    return "skip";
  }
  if (isGroupElement(element)) {
    return "group";
  }
  if (isSvgShapeElement(element)) {
    return "vector";
  }
  if (isImageElement(element)) {
    return "image";
  }
  if (isPlainTextElement(element)) {
    return "text";
  }
  if (isInlineParagraph(element)) {
    return "text-paragraph";
  }
  if (isFormElementWithPlaceholder(element) && hasPlaceholderText(element)) {
    return "form-with-placeholder";
  }
  return "frame";
}

function isNonVisualElement(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  return (
    tagName === "script" ||
    tagName === "style" ||
    tagName === "head" ||
    tagName === "meta" ||
    tagName === "title" ||
    tagName === "link" ||
    tagName === "noscript" ||
    tagName === "template" ||
    tagName === "comment" ||
    tagName === "defs" ||
    tagName === "desc" ||
    tagName === "clipPath"
  );
}

function isHiddenElement(element: Element): boolean {
  const computedStyle = window.getComputedStyle(element);

  if (computedStyle.display === "none") {
    return true;
  }

  const clip = computedStyle.clip;
  if (clip === "rect(0px, 0px, 0px, 0px)" || clip === "rect(0, 0, 0, 0)") {
    return true;
  }

  return false;
}

function isGroupElement(element: Element): boolean {
  return element.tagName.toLowerCase() === "g";
}

function isSvgShapeElement(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  return (
    tagName === "path" ||
    tagName === "circle" ||
    tagName === "rect" ||
    tagName === "ellipse" ||
    tagName === "line" ||
    tagName === "polyline" ||
    tagName === "polygon"
  );
}

function isImageElement(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  return tagName === "img" || tagName === "video";
}

/**
 * A plain text element is a leaf with text content and no painted box of its
 * own (no padding, border, or background). The whole element is treated as
 * text rather than a frame containing text.
 */
function isPlainTextElement(element: Element): boolean {
  const computedStyle = window.getComputedStyle(element);
  const hasText = !!(element.textContent || "").trim().length;

  return (
    hasText && element.children.length === 0 && hasNoPaintedBox(computedStyle)
  );
}

/**
 * Whether an element paints no box of its own — transparent background, no
 * padding, no border. Such an element can be collapsed into text without
 * losing visible decoration.
 */
function hasNoPaintedBox(computedStyle: CSSStyleDeclaration): boolean {
  const isTextClipped =
    computedStyle.backgroundClip === "text" ||
    // biome-ignore lint/suspicious/noExplicitAny: webkit property is not in CSSStyleDeclaration
    (computedStyle as any).webkitBackgroundClip === "text";

  const hasNoBackground =
    (TRANSPARENT_COLOR_VALUES.includes(computedStyle.backgroundColor) ||
      isTextClipped) &&
    (!computedStyle.backgroundImage ||
      computedStyle.backgroundImage === "none" ||
      isTextClipped);

  const hasNoPadding =
    (computedStyle.paddingTop === "0px" || computedStyle.paddingTop === "") &&
    (computedStyle.paddingRight === "0px" ||
      computedStyle.paddingRight === "") &&
    (computedStyle.paddingBottom === "0px" ||
      computedStyle.paddingBottom === "") &&
    (computedStyle.paddingLeft === "0px" || computedStyle.paddingLeft === "");

  const hasNoBorder =
    (computedStyle.borderTopWidth === "0px" ||
      computedStyle.borderTopWidth === "") &&
    (computedStyle.borderRightWidth === "0px" ||
      computedStyle.borderRightWidth === "") &&
    (computedStyle.borderBottomWidth === "0px" ||
      computedStyle.borderBottomWidth === "") &&
    (computedStyle.borderLeftWidth === "0px" ||
      computedStyle.borderLeftWidth === "");

  return hasNoBackground && hasNoPadding && hasNoBorder;
}

// Inline children that must NOT be merged into the paragraph text: replaced
// elements, line breaks, and links/buttons whose semantics (href, target)
// would be silently lost in a flat TEXT node.
const NON_MERGEABLE_INLINE_TAGS = new Set([
  "img",
  "svg",
  "input",
  "textarea",
  "br",
  "a",
  "button",
]);
export function hasOnlyInlineFlowChildren(element: Element): boolean {
  const childElements = Array.from(element.children);
  if (childElements.length === 0) {
    return false;
  }

  for (const child of childElements) {
    const childStyle = window.getComputedStyle(child);
    if (
      childStyle.display !== "inline" &&
      childStyle.display !== "inline-block" &&
      childStyle.display !== "inline-flex"
    ) {
      return false;
    }
    const position = childStyle.position;
    if (position === "absolute" || position === "fixed") {
      return false;
    }
    const float = childStyle.float;
    if (float === "left" || float === "right") {
      return false;
    }
  }
  return true;
}

/**
 * A block whose rendered children are all inline runs (sibling text nodes and
 * inline leaf elements) and which has no painted box of its own. Such a block
 * is one paragraph and must convert to a single TEXT node so its runs share
 * one layout pass — see the multi-segment text plan.
 *
 * Conservative on purpose: anything that would lose information when flattened
 * to text — a painted box on the block or on a child, a link/replaced/nested
 * child, or preserved whitespace (`white-space` other than the collapsing
 * defaults) — falls through to `frame`, preserving today's behavior.
 */
export function isInlineParagraph(element: Element): boolean {
  if (!(element.textContent || "").trim().length) {
    return false;
  }
  const childElements = Array.from(element.children);
  if (childElements.length === 0) {
    return false; // solo text → handled by `isPlainTextElement` above
  }

  const computedStyle = window.getComputedStyle(element);
  // A painted box on the block would be dropped when collapsing to a TEXT node.
  if (!hasNoPaintedBox(computedStyle)) {
    return false;
  }
  // The assembler now respects CSS white-space collapsing rules natively,
  // so we no longer need to exclude pre-wrap / pre-line / break-spaces.

  for (const child of childElements) {
    if (NON_MERGEABLE_INLINE_TAGS.has(child.tagName.toLowerCase())) {
      return false;
    }
    if (child.children.length > 0) {
      return false; // nested structure — not a flat inline run
    }
    const childStyle = window.getComputedStyle(child);
    if (
      childStyle.display !== "inline" &&
      childStyle.display !== "inline-block"
    ) {
      return false;
    }
    // A child with its own painted box (e.g. a highlighted <span> or a <kbd>
    // keycap) must stay a frame so its box survives.
    if (!hasNoPaintedBox(childStyle)) {
      return false;
    }
  }
  return true;
}

const FORM_PLACEHOLDER_EXCLUDED_TYPES = [
  "checkbox",
  "radio",
  "submit",
  "button",
  "file",
  "hidden",
];

function isFormElementWithPlaceholder(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  const inputType = (element as HTMLInputElement).type?.toLowerCase() || "";

  return (
    (tagName === "input" &&
      !FORM_PLACEHOLDER_EXCLUDED_TYPES.includes(inputType)) ||
    tagName === "textarea"
  );
}

function hasPlaceholderText(element: Element): boolean {
  const placeholder = element.getAttribute("placeholder");
  return !!(placeholder && placeholder.trim().length > 0);
}
