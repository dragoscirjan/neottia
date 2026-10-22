#pragma once

namespace neottia::repository_store {

/** Returns the Node.js platform identifier implemented by this binary. */
const char* Platform();

/** Moves source to destination without replacing an existing destination. */
int RenameNoReplace(const char* source, const char* destination);

/** Reports whether path resides on a certified local filesystem. */
int SupportsLocalPath(const char* path, bool* supported);

/** Flushes an open file or directory descriptor with platform durability semantics. */
int SyncDescriptor(int descriptor);

}  // namespace neottia::repository_store
