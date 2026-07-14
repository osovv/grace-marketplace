import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

/** Whether the authored path must already exist or may name a future output. */
export type ContainedPathMode = "existing" | "output";

/** Options for resolving one authored project-relative path. */
export type ContainedPathOptions = {
  /** Directory that owns the authored path and bounds the resolved realpath. */
  allowedRoot?: string;
  /** Existing inputs resolve themselves; outputs resolve their nearest existing ancestor. */
  mode?: ContainedPathMode;
  /** Optional required extension including the leading dot. */
  extension?: string;
};

/** Canonical contained path while retaining the original authored value for diagnostics. */
export type ContainedProjectPath = {
  authoredPath: string;
  relativePath: string;
  absolutePath: string;
};

/** Stable error raised for invalid or escaping authored paths. */
export class ProjectPathError extends Error {
  /** Machine-readable diagnostic code. */
  readonly code:
    | "path.empty"
    | "path.absolute"
    | "path.traversal"
    | "path.invalid-drive"
    | "path.extension"
    | "path.missing"
    | "path.symlink-escape";
  /** Unmodified path supplied by the artifact author. */
  readonly authoredPath: string;

  /** Creates one path error without normalizing away the authored value. */
  constructor(code: ProjectPathError["code"], authoredPath: string, message: string) {
    super(message);
    this.name = "ProjectPathError";
    this.code = code;
    this.authoredPath = authoredPath;
  }
}

/**
 * Converts slash or backslash input to one slash-separated project-relative path.
 * Rejects Unix absolute paths, drive paths, UNC paths, empty segments that imply malformed roots,
 * and every parent-traversal segment before any filesystem read occurs.
 */
export function normalizeProjectRelativePath(authoredPath: string): string {
  if (!authoredPath || !authoredPath.trim()) {
    throw pathError("path.empty", authoredPath, "Project-relative path must not be empty.");
  }

  const portablePath = authoredPath.replaceAll("\\", "/");
  if (/^[A-Za-z]:\//.test(portablePath)) {
    throw pathError("path.absolute", authoredPath, "Drive-absolute paths are not allowed.");
  }
  if (/^[A-Za-z]:/.test(portablePath)) {
    throw pathError("path.invalid-drive", authoredPath, "Drive-relative paths are not allowed.");
  }
  if (portablePath.startsWith("/")) {
    throw pathError("path.absolute", authoredPath, "Absolute paths are not allowed.");
  }

  const segments = portablePath.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw pathError("path.traversal", authoredPath, "Parent traversal is not allowed.");
  }

  const normalizedSegments = segments.filter((segment) => segment !== "" && segment !== ".");
  if (normalizedSegments.length === 0) {
    throw pathError("path.empty", authoredPath, "Project-relative path must name a project entry.");
  }

  return normalizedSegments.join("/");
}

/**
 * Resolves a normalized project-relative path inside allowedRoot.
 * Existing mode realpaths the target. Output mode realpaths the nearest existing ancestor and
 * appends only the validated nonexistent suffix. Any lexical or realpath escape throws ProjectPathError.
 */
export function resolveContainedProjectPath(
  projectRoot: string,
  authoredPath: string,
  options: ContainedPathOptions = {},
): ContainedProjectPath {
  const relativePath = normalizeProjectRelativePath(authoredPath);
  if (options.extension && path.posix.extname(relativePath) !== options.extension) {
    throw pathError("path.extension", authoredPath, `Path must use the ${options.extension} extension.`);
  }

  const baseRoot = path.resolve(projectRoot);
  const allowedRoot = path.resolve(options.allowedRoot ?? baseRoot);
  const lexicalTarget = path.resolve(baseRoot, ...relativePath.split("/"));
  if (!isInside(allowedRoot, lexicalTarget)) {
    throw pathError("path.symlink-escape", authoredPath, "Path resolves outside its allowed root.");
  }

  let realTarget: string;
  if ((options.mode ?? "existing") === "existing") {
    if (!existsSync(lexicalTarget)) {
      throw pathError("path.missing", authoredPath, "Required project path does not exist.");
    }
    realTarget = realpathSync(lexicalTarget);
  } else {
    const { ancestor, suffix } = nearestExistingAncestor(lexicalTarget, authoredPath);
    realTarget = path.join(realpathSync(ancestor), ...suffix);
  }

  const realAllowedRoot = realpathSync(allowedRoot);
  if (!isInside(realAllowedRoot, realTarget)) {
    throw pathError("path.symlink-escape", authoredPath, "Path resolves through a symlink outside its allowed root.");
  }

  return {
    authoredPath,
    relativePath,
    absolutePath: realTarget,
  };
}

function nearestExistingAncestor(target: string, authoredPath: string): { ancestor: string; suffix: string[] } {
  const suffix: string[] = [];
  let current = target;

  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      throw pathError("path.missing", authoredPath, "No existing ancestor could be resolved for the output path.");
    }
    suffix.unshift(path.basename(current));
    current = parent;
  }

  return { ancestor: current, suffix };
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function pathError(code: ProjectPathError["code"], authoredPath: string, detail: string): ProjectPathError {
  return new ProjectPathError(code, authoredPath, `${detail} Authored path: ${JSON.stringify(authoredPath)}.`);
}
