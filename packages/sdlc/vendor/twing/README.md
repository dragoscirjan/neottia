# Vendored Twing runtime

This directory contains the Twing 7.3.1 CommonJS runtime and its TypeScript declarations. See `LICENSE` for the upstream BSD-2-Clause license.

Neottia vendors this runtime because Twing 7.3.1 depends on Locutus 2.x, which has unresolved security advisories. `@neottia/sdlc` instead depends on Locutus 3.0.36.

The runtime differs from the upstream Twing bundle only in its Locutus imports. Category imports use the Locutus 3 `index` modules, and function imports select their named CommonJS exports.
