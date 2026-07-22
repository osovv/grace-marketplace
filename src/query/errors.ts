/** Stable user-facing query command error code. */
export type GraceCommandErrorCode = "invalid-project" | "not-found" | "ambiguous-target" | "invalid-arguments";

/** Error intentionally safe to render without a stack trace. */
export class GraceCommandError extends Error {
  /** Machine-readable error code. */
  readonly code: GraceCommandErrorCode;
  /** Process exit code used by query commands. */
  readonly exitCode: number;
  /** Optional lint or projection issue codes supporting the failure. */
  readonly issues?: string[];

  /** Creates one renderable command error. */
  constructor(code: GraceCommandErrorCode, message: string, options: { exitCode?: number; issues?: string[] } = {}) {
    super(message);
    this.name = "GraceCommandError";
    this.code = code;
    this.exitCode = options.exitCode ?? 1;
    this.issues = options.issues;
  }
}

/** JSON output returned for every query-command failure requested in JSON mode. */
export type GraceCommandErrorEnvelope = {
  schemaVersion: "1.0.0";
  ok: false;
  error: {
    code: GraceCommandErrorCode;
    message: string;
    issues?: string[];
  };
};

/** Executes any GRACE command operation with stable text or JSON failures. */
export async function runGraceCommand(
  format: "text" | "json",
  operation: () => void | Promise<void>,
  fallbackMessage: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const commandError = error instanceof GraceCommandError
      ? error
      : new GraceCommandError("invalid-project", fallbackMessage);
    if (format === "json") {
      const envelope: GraceCommandErrorEnvelope = {
        schemaVersion: "1.0.0",
        ok: false,
        error: {
          code: commandError.code,
          message: commandError.message,
          ...(commandError.issues?.length ? { issues: commandError.issues } : {}),
        },
      };
      process.stdout.write(`${JSON.stringify(envelope)}\n`);
    } else {
      process.stderr.write(`${commandError.message}\n`);
    }
    process.exitCode = commandError.exitCode;
  }
}

/** Executes a query command and renders stable text or JSON failures without stack traces. */
export async function runQueryCommand(
  format: "text" | "json",
  operation: () => void | Promise<void>,
): Promise<void> {
  return runGraceCommand(format, operation, "Unable to complete the GRACE query. Run `grace lint --path PROJECT` for actionable diagnostics.");
}
