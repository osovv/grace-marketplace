export type AuditMeta = Record<string, unknown>;

export function auditLog(
  module: string,
  fn: string,
  block: string,
  message: string,
  meta?: AuditMeta,
): void {
  const base = `[${module}][${fn}][${block}] ${message}`;
  if (meta && Object.keys(meta).length > 0) {
    console.log(`${base} ${JSON.stringify(meta)}`);
    return;
  }
  console.log(base);
}
