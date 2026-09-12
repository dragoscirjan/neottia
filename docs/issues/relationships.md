# Issue relationships

`parent` is persisted on a child. Children are derived. The graph rejects missing parents, self-parenting, illegal hierarchy, and parent cycles.

`depends_on` is directional. If A depends on B, hydrated A reports `blocked_by: [B]` and hydrated B reports `blocks: [A]`. Dependency cycles fail validation.

`relates_to` is symmetric but stored only on the lexical owner, the smaller ID. `issue_relate` returns that owner and its revision for later `issue_unrelate`. `duplicates` and `supersedes` are directional and are stored on the source issue.

Relationship creation is idempotent. Removal requires the deterministic owner's exact revision. The complete active and archived graph validates targets and duplicate edges before publication.
