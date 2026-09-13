# @neottia/pi-adapter

`@neottia/pi-adapter` projects Neottia assets and package activation plans for Pi. It implements `HarnessAdapter` from `@neottia/harness-adapter` and performs no filesystem or process operations.

## Install

```sh
pnpm add @neottia/harness-adapter @neottia/pi-adapter
```

## Use

```ts
import { piHarnessAdapter } from "@neottia/pi-adapter";

piHarnessAdapter.projectPrompt({
  id: "plan",
  scope: "project",
  body: "Plan the requested change.\n",
  metadata: {
    description: "Plan one change",
    argumentHint: "<issue>",
  },
});
```

Project targets use `.pi`. Global targets use `.pi/agent` under the symbolic `home` anchor. The adapter supports prompts, skills, local extensions, and Pi package entries in `settings.json`.

See the [harness adapter guide](../../docs/harnesses/adapters.md) for the shared contract and complete feature matrix.

Pi has no built-in MCP configuration or native agent asset. The adapter returns `UNSUPPORTED_HOST_FEATURE` for those requests instead of generating extension-based emulation.

Prompt templates support `description` and `argument-hint`. Agent, model, subtask, permission, thinking, and step metadata is unsupported. Resource changes return a `/reload` notice. Package activation returns a restart notice so Pi can install and activate the package on startup.

The declaration does not list a tested Pi version because repository validation does not execute a Pi binary.
