# Knowledge Graph Maintenance

The `.grace/graph/` directory is the single source of truth for the project's module structure. It maps every module, its public interface, its dependencies, and how modules connect to each other. The `index.xml` file lists GD-* document routes and the modules each document owns.

## Structure

```xml
<GraceGraphIndex graceVersion="4.0">
  <GraphDocuments>
    <GD-MAIN>
      <Path>graph/main.xml</Path>
      <Owns>
        <M-CONFIG />
        <M-DB />
      </Owns>
    </GD-MAIN>
  </GraphDocuments>
</GraceGraphIndex>
```

Each GD-* document contains the actual module and data-flow definitions:

```xml
<GraceGraphDocument graceVersion="4.0">
  <GD-MAIN>
    <M-CONFIG>
      <Summary>Application configuration and environment management</Summary>
      <Path>src/config/index.ts</Path>
      <M-DB />
    </M-CONFIG>
    <M-DB>
      <Summary>Database connection and query layer</Summary>
      <Path>src/db/index.ts</Path>
    </M-DB>
  </GD-MAIN>
</GraceGraphDocument>
```

## Module Tag Convention

Every module uses a **unique ID as the XML tag name**:
- `<M-CONFIG>` not `<Module ID="M-CONFIG">`
- `<M-DB>` not `<Module ID="M-DB">`

This eliminates closing-tag polysemy — `</M-CONFIG>` is unambiguous while multiple `</Module>` closings create "semantic soup" for LLMs.

Canonical grep-stable naming rules:

- module IDs use exact uppercase kebab form with `M-` prefix only
- verification refs use exact `V-M-<MODULE-SUFFIX>` form only
- annotation tags use exact prefixes: `fn-`, `type-`, `class-`, `export-`, `const-`
- edge tags use exact `CrossLink` spelling and exact `from`, `to`, `relation` attributes
- avoid alternate synonyms like `moduleId`, `verificationId`, `edge`, `source`, or `target` when canonical anchors already exist

## Module Types

| Type | Description |
|------|-------------|
| ENTRY_POINT | Where execution begins (CLI, HTTP handler, event listener) |
| CORE_LOGIC | Business rules and domain logic |
| DATA_LAYER | Persistence, queries, caching |
| UI_COMPONENT | User interface elements |
| UTILITY | Shared helpers, configuration, logging |
| INTEGRATION | External service adapters |

## Annotation Tags

| Tag | Purpose |
|-----|---------|
| `<fn-name>` | Public function in the module's external contract |
| `<type-Name>` | Public type/interface exposed by the module |
| `<class-Name>` | Public class in the module interface |
| `<export-name>` | Public named export (constants, config objects) |
| `<const-NAME>` | Public constant |

Do not mirror every private helper from the source file into `<annotations>`. Private orchestration helpers, local-only utility functions, and implementation-only types stay in the module file header and local contracts.

## Links

Links between modules are expressed as direct child tags:

```xml
<M-CONFIG>
  <Summary>Config management</Summary>
  <M-DB />   <!-- M-CONFIG links to M-DB -->
</M-CONFIG>
```

## Verification References

The `.grace/verification/` directory provides matching V-M-* entries. The verification reference is mechanically derivable from the module ID by replacing the leading `M-` with `V-M-`.

This keeps navigation and proof linked:
- the graph answers where the module lives and what it depends on
- the verification plan answers how the module proves correctness

## Maintenance Rules

1. **Always current** — when you add a module, add it to the graph. When you add a dependency, link it. Never let the graph drift from reality.
2. **Scan on doubt** — if unsure whether the graph is current, run `$grace-refresh` to scan and sync.
3. **Version tracking** — increment the graph index when the graph changes structurally (new modules, removed modules).
4. **Annotations match the public interface** — if a module's public exports change, update its `<annotations>` section.
5. **Verification refs stay valid** — if a module's verification entry changes ID, update its graph document.
6. **No orphans** — if a module is deleted, remove its graph entry and all links referencing it.
