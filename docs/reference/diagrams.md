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

## License material

Archify 3.2.0 is licensed under the MIT License. The documentation bundle includes:

- `docs/public/diagrams/ARCHIFY-LICENSE.txt`;
- `docs/public/diagrams/ARCHIFY-THIRD-PARTY-NOTICES.md`.

Archify 3.2.0 does not contain a separate `NOTICE` file. The generated artifacts retain their Archify identification, and this page records the tool version and source commit.
