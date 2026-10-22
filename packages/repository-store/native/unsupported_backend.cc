#include "platform_backend.h"

#include <cerrno>

namespace neottia::repository_store {

const char* Platform() {
#if defined(_WIN32)
  return "win32";
#elif defined(__APPLE__)
  return "darwin";
#elif defined(__FreeBSD__)
  return "freebsd";
#else
  return "unsupported";
#endif
}

int RenameNoReplace(const char*, const char*) { return ENOSYS; }

int SupportsLocalPath(const char*, bool* supported) {
  *supported = false;
  return 0;
}

int SyncDescriptor(int) { return ENOSYS; }

}  // namespace neottia::repository_store
