# Rojo and language-server integration

Rojo 7.7.1 is an adopted optional adapter. It builds and generates an all-object sourcemap from the same captured input tree. Real integration tests verify generated JSON configuration, original Luau file provenance, and rejection of mixed output pairs. The built script is the analyzed source; original CRLF and generated-source mappings remain distinct.

Rojo executable SHA-256: `e73e956676b8b27ff43f2c5d80e040121e49c2f9e8cc69fd65123799473cf6d3`.

The local toolchain has no luau-lsp executable. Its documented Rojo-aware definitions/references are useful candidates, but no accuracy or offline packaging claim is made here. Integration is deferred: the official parser and explicit Roblox resolution passes remain the v1 source of truth; a future LSP adapter must be pinned, supplied with compatible definitions, and demonstrate useful evidence on the same adversarial fixtures. Absence of this optional tool does not affect place or Rojo imports.

First adapter limits: DataModel roots; project-relative mounts inside the selected directory; no symlink/junction escapes; no source editing, Studio syncing, or syncback. A sourcemap is not an input inventory or proof of statement-level source positions.
