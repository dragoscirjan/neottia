# Grounded answers with Ollama

`web_ask` selects relevant canonical stash records, builds a bounded prompt, and calls the configured Ollama `/api/generate` endpoint. Neottia reads the newline-delimited JSON response as it arrives. It bounds each incomplete frame and the cumulative answer, rejects malformed data immediately, and requires one terminal frame before returning `answer` and `contextUrls`.

Start Ollama and make the configured model available:

```sh
ollama serve
ollama pull llama3
```

The default endpoint is `http://localhost:11434` and the default model is `llama3`. This local endpoint is the only intentional exception to the public-network destination policy.

Searchable labels page excerpts as untrusted source material and instructs the model not to follow commands inside them. `ask.context_bytes` caps the complete UTF-8 prompt, including instructions, question, delimiters, URLs, titles, and content. Pages are added deterministically until the limit is reached.

No stash match returns `NO_RELEVANT_CONTEXT` without contacting Ollama. An unreachable model, a deadline, an oversized response, malformed stream frames, data after the terminal frame, or a missing terminal frame also returns a stable error. Neottia closes the HTTP response as soon as stream validation fails. Model answers may still be wrong. Use `contextUrls` to check important claims.
