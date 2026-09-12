# Requirements

Check these restrictions before a filesystem quick start. Filesystem-backed Memory, Issues, and Design Docs fail closed outside the supported environment.

| Component                               | Runtime                                                                        | Other requirements                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `@neottia/core`                         | Node.js 20 or newer                                                            | Browser bundles are also published.                                                      |
| Repository Store and filesystem domains | Node.js 22.16 or newer, or Bun 1.3.13 or newer for direct Repository Store use | Linux x64 or arm64; C++17 compiler, Python, Make, and Linux headers for native builds.   |
| MCP servers                             | Node.js 22.16 or newer                                                         | The same filesystem requirements as their domain.                                        |
| Pi and OpenCode extensions              | Host Node.js runtime                                                           | The same requirements as their domain package.                                           |
| PostgreSQL Memory                       | Node.js 22.16 or newer                                                         | PostgreSQL credentials and an explicit organization, project, and scope ownership model. |
| Searchable Core                         | Node.js 22.16 or newer                                                         | No network or persistent storage implementation is included.                             |

Filesystem domains require a recognized local ext4, XFS, Btrfs, tmpfs, or overlay filesystem. The kernel must provide `renameat2(RENAME_NOREPLACE)`, and the canonical root and control directory must support same-volume hard links. macOS, Windows, network or shared filesystems, unsupported kernels or C libraries, and missing native builds fail closed for leased operations.

All four capability shards default to `enabled: false`. Enable only the capabilities you use.

Pi can ask before rebuilding a stale cache. OpenCode and MCP are non-interactive, so `prompt` becomes `rebuild`. An explicit `fail` remains `fail`.

If a native addon fails to install, confirm the Node version, architecture, compiler, Python, Make, headers, filesystem, and kernel support. Do not treat `UnsupportedRuntimeError` as canonical-data corruption. See [Repository Store diagnostics](/repository-store).
