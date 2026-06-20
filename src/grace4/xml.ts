import { existsSync, readFileSync } from "node:fs";
import { XMLParser, XMLValidator } from "fast-xml-parser";

import type { Grace4Issue } from "./types";

const ATTRIBUTE_NODE = ":@";
const ATTRIBUTE_PREFIX = "@_";
const TEXT_NODE = "#text";
const CDATA_NODE = "#cdata";

type OrderedXmlEntry = Record<string, unknown>;

/** Parsed XML node preserving the original tag name and child order. */
export type GraceXmlNode = {
  tag: string;
  attributes: Record<string, string>;
  children: GraceXmlNode[];
  text: string;
};

/** Parsed GRACE XML artifact root plus diagnostics. */
export type ParsedGraceXmlArtifact = {
  file: string;
  root: GraceXmlNode | null;
  issues: Grace4Issue[];
};

/** Parser configured for dynamic GRACE tag names and explicit attributes. */
export function createGraceXmlParser(): XMLParser {
  return new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: ATTRIBUTE_PREFIX,
    textNodeName: TEXT_NODE,
    cdataPropName: CDATA_NODE,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
  });
}

/** Parses one XML artifact string into a normalized root node and parse diagnostics. */
export function parseGraceXmlArtifact(file: string, text: string): ParsedGraceXmlArtifact {
  const validationResult = XMLValidator.validate(text, {
    allowBooleanAttributes: true,
  });

  if (validationResult !== true) {
    const error = validationResult.err;
    return {
      file,
      root: null,
      issues: [
        {
          severity: "error",
          code: "xml.parse",
          file,
          line: error.line,
          message: error.msg,
        },
      ],
    };
  }

  try {
    const parsed = createGraceXmlParser().parse(text);
    const root = normalizeParsedRoot(parsed);

    if (!root) {
      return {
        file,
        root: null,
        issues: [
          {
            severity: "error",
            code: "xml.parse",
            file,
            message: "XML artifact does not contain a root element.",
          },
        ],
      };
    }

    return { file, root, issues: [] };
  } catch (error) {
    return {
      file,
      root: null,
      issues: [
        {
          severity: "error",
          code: "xml.parse",
          file,
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

/** Reads and parses one XML artifact from disk. Missing files produce a validation issue. */
export function readGraceXmlArtifact(file: string): ParsedGraceXmlArtifact {
  if (!existsSync(file)) {
    return {
      file,
      root: null,
      issues: [
        {
          severity: "error",
          code: "xml.missing-file",
          file,
          message: `XML artifact not found: ${file}`,
        },
      ],
    };
  }

  return parseGraceXmlArtifact(file, readFileSync(file, "utf8"));
}

/** Returns direct children whose tag exactly matches the requested name. */
export function childNodes(node: GraceXmlNode, tag: string): GraceXmlNode[] {
  return node.children.filter((child) => child.tag === tag);
}

/** Returns the first direct child text value for the requested tag. */
export function childText(node: GraceXmlNode, tag: string): string | undefined {
  return childNodes(node, tag)[0]?.text;
}

/** Walks all descendants depth-first, including the starting node. */
export function* walkNodes(node: GraceXmlNode): Iterable<GraceXmlNode> {
  yield node;
  for (const child of node.children) {
    yield* walkNodes(child);
  }
}

/** Returns true when the node has any attributes other than the allowed list. */
export function hasForbiddenAttributes(node: GraceXmlNode, allowed: ReadonlySet<string>): boolean {
  return Object.keys(node.attributes).some((attribute) => !allowed.has(attribute));
}

function normalizeParsedRoot(parsed: unknown): GraceXmlNode | null {
  if (!Array.isArray(parsed)) {
    return null;
  }

  for (const entry of parsed) {
    const node = normalizeElementEntry(entry);
    if (node) {
      return node;
    }
  }

  return null;
}

function normalizeElementEntry(entry: unknown): GraceXmlNode | null {
  if (!isXmlEntry(entry)) {
    return null;
  }

  const tag = Object.keys(entry).find((key) => key !== ATTRIBUTE_NODE && key !== TEXT_NODE && key !== CDATA_NODE);
  if (!tag) {
    return null;
  }

  const rawChildren = entry[tag];
  const attributes = normalizeAttributes(entry[ATTRIBUTE_NODE]);
  const children: GraceXmlNode[] = [];
  const textParts: string[] = [];

  if (Array.isArray(rawChildren)) {
    for (const childEntry of rawChildren) {
      if (!isXmlEntry(childEntry)) {
        continue;
      }

      const directText = childEntry[TEXT_NODE];
      if (typeof directText === "string") {
        textParts.push(directText);
      }

      const directCdata = childEntry[CDATA_NODE];
      if (Array.isArray(directCdata)) {
        textParts.push(extractSpecialText(directCdata));
      }

      const child = normalizeElementEntry(childEntry);
      if (child) {
        children.push(child);
      }
    }
  } else if (typeof rawChildren === "string") {
    textParts.push(rawChildren);
  }

  return {
    tag,
    attributes,
    children,
    text: textParts.join(""),
  };
}

function normalizeAttributes(rawAttributes: unknown): Record<string, string> {
  if (!isXmlEntry(rawAttributes)) {
    return {};
  }

  const attributes: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(rawAttributes)) {
    const name = rawName.startsWith(ATTRIBUTE_PREFIX) ? rawName.slice(ATTRIBUTE_PREFIX.length) : rawName;
    attributes[name] = rawValue == null ? "" : String(rawValue);
  }

  return attributes;
}

function extractSpecialText(entries: unknown[]): string {
  return entries
    .map((entry) => {
      if (!isXmlEntry(entry)) {
        return "";
      }
      const text = entry[TEXT_NODE];
      return typeof text === "string" ? text : "";
    })
    .join("");
}

function isXmlEntry(value: unknown): value is OrderedXmlEntry {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
