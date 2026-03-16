# Knowledge Graph Maintenance

The file `docs/knowledge-graph.xml` is the single source of truth for the project's module structure. It maps every module, its exports, its dependencies, and how modules connect to each other.

## Structure

```xml
<KnowledgeGraph>
  <Project NAME="project-name" VERSION="1.0.0">
    <keywords>keyword1, keyword2, keyword3</keywords>
    <annotation>Brief project description for LLM domain activation</annotation>

    <M-CONFIG NAME="Config" TYPE="UTILITY" STATUS="implemented">
      <purpose>Application configuration and environment management</purpose>
      <path>src/config/index.ts</path>
      <depends>none</depends>
      <verification-ref>V-M-CONFIG</verification-ref>
      <annotations>
        <fn-loadConfig PURPOSE="Load and validate config from environment" />
        <type-AppConfig PURPOSE="Configuration type definition" />
        <export-config PURPOSE="Singleton config instance" />
      </annotations>
    </M-CONFIG>

    <M-DB NAME="Database" TYPE="DATA_LAYER">
      <purpose>Database connection and query layer</purpose>
      <path>src/db/index.ts</path>
      <depends>M-CONFIG</depends>
      <annotations>
        <fn-connect PURPOSE="Establish database connection" />
        <fn-query PURPOSE="Execute parameterized query" />
        <class-DatabasePool PURPOSE="Connection pool manager" />
      </annotations>
      <CrossLink from="M-DB" to="M-CONFIG" relation="reads-config" />
    </M-DB>

  </Project>
</KnowledgeGraph>
```

## Module Tag Convention

Every module uses a **unique ID as the XML tag name**:
- `<M-CONFIG>` not `<Module ID="M-CONFIG">`
- `<M-DB>` not `<Module ID="M-DB">`

This eliminates closing-tag polysemy — `</M-CONFIG>` is unambiguous while multiple `</Module>` closings create "semantic soup" for LLMs.

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
| `<fn-name>` | Exported function |
| `<type-Name>` | Exported type/interface |
| `<class-Name>` | Exported class |
| `<export-name>` | Named export (constants, config objects) |
| `<const-NAME>` | Exported constant |

## CrossLinks

CrossLinks are self-closing tags that connect modules:
```xml
<CrossLink from="M-SOURCE" to="M-TARGET" relation="description" />
```

Common relations: `reads-config`, `queries-db`, `calls-api`, `renders-component`, `validates-input`.

CrossLinks MUST be bidirectionally consistent — if A depends on B, the CrossLink should exist in A's entry.

## Verification References

Modules may carry a `<verification-ref>` pointing to the matching `V-M-xxx` entry in `docs/verification-plan.xml`.

This keeps navigation and proof linked:
- the graph answers where the module lives and what it depends on
- the verification plan answers how the module proves correctness

## Maintenance Rules

1. **Always current** — when you add a module, add it to the graph. When you add a dependency, add a CrossLink. Never let the graph drift from reality.
2. **Scan on doubt** — if unsure whether the graph is current, run `$grace-refresh` to scan and sync.
3. **Version tracking** — increment the Project VERSION when the graph changes structurally (new modules, removed modules).
4. **Annotations match exports** — if a module's exports change, update its `<annotations>` section.
5. **Verification refs stay valid** — if a module's verification entry changes ID, update `<verification-ref>`.
6. **No orphans** — if a module is deleted, remove its graph entry and all CrossLinks referencing it.
