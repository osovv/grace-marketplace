import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { childText, parseGraceXmlArtifact, readGraceXmlArtifact, walkNodes } from "./xml";

describe("GRACE 4 XML parser adapter", () => {
  it("returns xml.parse diagnostics for malformed XML instead of throwing", () => {
    const result = parseGraceXmlArtifact("broken.xml", `<GraceRequirements graceVersion="4.0"><Open></GraceRequirements>`);

    expect(result.root).toBeNull();
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe("xml.parse");
  });

  it("preserves dynamic semantic tags exactly", () => {
    const result = parseGraceXmlArtifact(
      "graph.xml",
      `<GraceGraphDocument graceVersion="4.0"><GD-MAIN><M-AUTH-SESSION><Links><DF-AUTH-TOKEN-FLOW /></Links></M-AUTH-SESSION></GD-MAIN></GraceGraphDocument>`,
    );

    expect(result.issues).toHaveLength(0);
    expect([...walkNodes(result.root!)].map((node) => node.tag)).toEqual([
      "GraceGraphDocument",
      "GD-MAIN",
      "M-AUTH-SESSION",
      "Links",
      "DF-AUTH-TOKEN-FLOW",
    ]);
  });

  it("treats CDATA as text rather than structural GRACE anchors", () => {
    const result = parseGraceXmlArtifact(
      "plan.xml",
      `<GraceChangePlan graceVersion="4.0" status="approved"><C-EXAMPLE><Snippet><![CDATA[<M-SHOULD-NOT-WALK />]]></Snippet></C-EXAMPLE></GraceChangePlan>`,
    );

    expect(result.issues).toHaveLength(0);
    expect(childText(result.root!.children[0]!.children[0]!, "missing")).toBeUndefined();
    expect([...walkNodes(result.root!)].map((node) => node.tag)).toEqual(["GraceChangePlan", "C-EXAMPLE", "Snippet"]);
    expect(result.root!.children[0]!.children[0]!.text).toBe("<M-SHOULD-NOT-WALK />");
  });

  it("represents root attributes separately from child tags", () => {
    const result = parseGraceXmlArtifact(
      "spec.xml",
      `<GraceChangeSpec graceVersion="4.0" status="approved"><C-EXAMPLE><Summary>Ship it.</Summary></C-EXAMPLE></GraceChangeSpec>`,
    );

    expect(result.issues).toHaveLength(0);
    expect(result.root?.tag).toBe("GraceChangeSpec");
    expect(result.root?.attributes).toEqual({ graceVersion: "4.0", status: "approved" });
    expect(result.root?.children.map((child) => child.tag)).toEqual(["C-EXAMPLE"]);
  });

  it("reads XML artifacts from disk and reports missing files", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace4-xml-"));
    const file = path.join(root, "artifact.xml");
    writeFileSync(file, `<GraceTechnology graceVersion="4.0"><Runtime>Bun</Runtime></GraceTechnology>`);

    expect(childText(readGraceXmlArtifact(file).root!, "Runtime")).toBe("Bun");
    expect(readGraceXmlArtifact(path.join(root, "missing.xml")).issues[0]?.code).toBe("xml.missing-file");
  });
});
