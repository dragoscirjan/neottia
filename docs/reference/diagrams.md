# Diagram sources and attribution

The learning diagrams are generated with [Archify](https://github.com/tt-a1i/archify), version 3.2.0 at commit `208acba8d412335185b2056fedf54b3405df43fb`. `docs/diagrams/archify.lock.json` records the tool and evidence revisions.

The diagram evidence is pinned to Neottia commit `d30ecaab86cf2d02a254736221221252c445fdfc`. Every node and relationship source range was validated against a clean checkout of that revision.

## Committed sources and artifacts

| Diagram                 | JSON source                                              | Self-contained artifact                       |
| ----------------------- | -------------------------------------------------------- | --------------------------------------------- |
| System map              | `docs/diagrams/sources/neottia-system.architecture.json` | `docs/public/diagrams/neottia-system.html`    |
| Lifecycle and authority | `docs/diagrams/sources/neottia-lifecycle.lifecycle.json` | `docs/public/diagrams/neottia-lifecycle.html` |
| Runtime data flow       | `docs/diagrams/sources/neottia-runtime.dataflow.json`    | `docs/public/diagrams/neottia-runtime.html`   |

The HTML files contain their scripts and styles. They do not load runtime JavaScript or CSS from a CDN. Repository source links in the diagrams are normal outbound links.

## Regenerate the diagrams

Create clean Archify and Neottia evidence checkouts outside the working tree:

```sh
git clone https://github.com/tt-a1i/archify.git ../archify

git -C ../archify checkout 208acba8d412335185b2056fedf54b3405df43fb

git worktree add ../neottia-diagram-evidence \
  d30ecaab86cf2d02a254736221221252c445fdfc
```

Then run these commands from the current Neottia repository root:

```sh
export ARCHIFY_UPDATE_CHECK_DISABLED=1

node ../archify/archify/bin/archify.mjs finalize architecture \
  docs/diagrams/sources/neottia-system.architecture.json \
  docs/public/diagrams/neottia-system.html \
  --repo-root ../neottia-diagram-evidence \
  --quality showcase

node ../archify/archify/bin/archify.mjs finalize lifecycle \
  docs/diagrams/sources/neottia-lifecycle.lifecycle.json \
  docs/public/diagrams/neottia-lifecycle.html \
  --repo-root ../neottia-diagram-evidence \
  --quality showcase

node ../archify/archify/bin/archify.mjs finalize dataflow \
  docs/diagrams/sources/neottia-runtime.dataflow.json \
  docs/public/diagrams/neottia-runtime.html \
  --repo-root ../neottia-diagram-evidence \
  --quality showcase
```

Review the generated routes visually after all automated gates pass. The system and runtime diagrams can contain routed detours that are valid but still benefit from a human readability check.

Archify also writes local delivery, finalize, summary, and browser-check JSON receipts during validation. Remove those receipts after validation. They contain machine-local absolute paths and are intentionally ignored and not committed.

## License material

Archify 3.2.0 is licensed under the MIT License. The documentation bundle includes:

- `docs/public/diagrams/ARCHIFY-LICENSE.txt`;
- `docs/public/diagrams/ARCHIFY-THIRD-PARTY-NOTICES.md`.

Archify 3.2.0 does not contain a separate `NOTICE` file. The generated artifacts retain their Archify identification, and this page records the tool version and source commit.
