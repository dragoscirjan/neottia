# Requirements

Check these restrictions before a filesystem quick start. Filesystem-backed Memory, Issues, and Design Docs fail closed outside the supported environment.

| Component                               | Runtime                                                                        | Other requirements                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `@neottia/core`                         | Node.js 20 or newer                                                            | Browser bundles are also published.                                                           |
| Repository Store and filesystem domains | Node.js 22.16 or newer, or Bun 1.3.13 or newer for direct Repository Store use | Linux x64 or arm64; C++17 compiler, Python, Make, and Linux headers for native builds.        |
| MCP servers                             | Node.js 22.16 or newer                                                         | The same filesystem requirements as their domain.                                             |
| Pi and OpenCode extensions              | Host Node.js runtime                                                           | The same requirements as their domain package.                                                |
| Claude Code distribution                | Claude Code with Node.js 22.20 or newer and `npx` on `PATH`                    | Project MCP approval and the same filesystem requirements as each enabled domain package.     |
| PostgreSQL Memory                       | Node.js 22.16 or newer                                                         | PostgreSQL credentials and an explicit organization, project, and scope ownership model.      |
| Searchable                              | Node.js 22.16 or newer                                                         | Repository Store filesystem support; public network access; Ollama only when using `web_ask`. |

Filesystem domains require a certified local filesystem: ext4, XFS, Btrfs, tmpfs, or overlay on Linux x64 or arm64; APFS on macOS x64 or arm64; NTFS on Windows Server x64; or UFS2 on FreeBSD 14.x x64 with Node.js. The canonical root and control directory must support the platform's documented publication, durability, identity, and same-volume hard-link guarantees. Network, shared, removable, and uncertified filesystems or runtime tuples fail closed for leased operations. See [Repository Store](/repository-store) for the exact matrix and diagnostics.

All four capability shards default to `enabled: false`. Enable only the capabilities you use.

Pi can ask before rebuilding a stale cache. OpenCode, Claude Code MCP, and generic MCP are non-interactive, so `prompt` becomes `rebuild`. An explicit `fail` remains `fail`.

If a native addon fails to install, confirm the Node version, architecture, compiler, Python, Make, headers, filesystem, and kernel support. Do not treat `UnsupportedRuntimeError` as canonical-data corruption. See [Repository Store diagnostics](/repository-store).
