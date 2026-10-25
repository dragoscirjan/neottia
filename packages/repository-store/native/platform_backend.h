#pragma once

#include <string>

namespace neottia::repository_store {

/** Observable filesystem properties used by platform diagnostics. */
struct LocalPathInspection {
  std::string filesystem_type;
  bool certified = false;
  bool local = false;
  bool writable = false;
  bool hard_links = false;
  bool stable_identity = false;
  bool atomic_no_replace = false;
  bool durability = false;
};

/** Returns the Node.js platform identifier implemented by this binary. */
const char* Platform();

/** Moves source to destination without replacing an existing destination. */
int RenameNoReplace(const char* source, const char* destination);

/** Inspects the filesystem properties required by Repository Store. */
int InspectLocalPath(const char* path, LocalPathInspection* inspection);

/** Reports whether path resides on a certified local filesystem. */
int SupportsLocalPath(const char* path, bool* supported);

/** Flushes an open file or directory descriptor with platform durability semantics. */
int SyncDescriptor(int descriptor);

}  // namespace neottia::repository_store
