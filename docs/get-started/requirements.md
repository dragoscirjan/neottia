# Requirements

Use this page to decide whether Neottia can safely operate in your environment.

## Recommended user setup

| Component                   | Requirement                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Neottia CLI and MCP servers | Node.js 22.20 or newer and pnpm 10 or newer                                                                   |
| Pi or OpenCode              | A supported host installation that runs in the target project directory                                       |
| Claude Code                 | Claude Code, Node.js 22.20 or newer, `npx` on `PATH`, and interactive approval of project `.mcp.json` servers |
| Source control              | Git for the default lifecycle configuration                                                                   |

`@neottia/core` supports Node.js 20 or newer, but the current CLI and distributed runtime packages require the newer user setup above. See the [dependency reference](/reference/dependencies) for exact package-manager, engine, and direct dependency declarations from every module manifest.

## Certified Repository Store tuples

Filesystem-backed Memory, Issues, Design Docs, and Searchable use Repository Store. Leased operations fail closed outside these certified tuples:

| Operating system         | Architecture | Runtime                       | Certified local filesystem                |
| ------------------------ | ------------ | ----------------------------- | ----------------------------------------- |
| Linux                    | x64, arm64   | Node.js 22.16+ or Bun 1.3.13+ | ext4, XFS, Btrfs, tmpfs, or local overlay |
| macOS                    | x64, arm64   | Node.js 22.16+ or Bun 1.3.13+ | APFS                                      |
| Windows Server 2022/2025 | x64          | Node.js 22.16+ or Bun 1.3.13+ | local NTFS                                |
| FreeBSD 14.x             | x64          | Node.js 22.16+                | local writable UFS2                       |

Windows arm64, FreeBSD arm64, and FreeBSD Bun are not supported. Network, shared, removable, and uncertified filesystems are not supported for leased operations.

Run `neottia doctor` in the actual project directory. Filesystem names alone are not enough: Doctor probes locality, write access, no-replace publication, hard links, stable identity, and durability barriers.

## Native binary installation

Certified tuples use verified native prebuilds when available. Installation verifies the workflow identity, source commit, tuple, size, SHA-256 digest, Sigstore signature, and GitHub attestation before use. The digest is checked again before the addon loads.

An availability failure may fall back to a source build. A source build needs Python, Make, a C++17 compiler, and platform headers. An integrity failure does not fall back; reinstall from a trusted package source and investigate the mismatch.

## Optional services

- PostgreSQL Memory needs PostgreSQL credentials and explicit organization, project, topic, and scope ownership.
- Searchable needs public network access for web retrieval. `web_ask` additionally needs the configured local Ollama endpoint.
- Remote issue, document, or source-control providers need the connection and credential environment names described in [provider configuration](/sdlc/providers).

All capability shards default to disabled unless `neottia init` enables them. Enable only what the repository uses.
