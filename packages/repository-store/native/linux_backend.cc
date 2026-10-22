#include "platform_backend.h"

#include <cerrno>
#include <fcntl.h>
#include <linux/fs.h>
#include <linux/magic.h>
#include <stdio.h>
#include <sys/vfs.h>
#include <unistd.h>

namespace neottia::repository_store {

const char* Platform() { return "linux"; }

int RenameNoReplace(const char* source, const char* destination) {
  if (renameat2(AT_FDCWD, source, AT_FDCWD, destination, RENAME_NOREPLACE) == 0) return 0;
  return errno;
}

int SupportsLocalPath(const char* path, bool* supported) {
  struct statfs state;
  if (statfs(path, &state) != 0) return errno;
  switch (state.f_type) {
    case EXT4_SUPER_MAGIC:
    case XFS_SUPER_MAGIC:
    case BTRFS_SUPER_MAGIC:
    case TMPFS_MAGIC:
    case OVERLAYFS_SUPER_MAGIC:
      *supported = true;
      break;
    default:
      *supported = false;
  }
  return 0;
}

int SyncDescriptor(int descriptor) {
  int result;
  do {
    result = fsync(descriptor);
  } while (result != 0 && errno == EINTR);
  return result == 0 ? 0 : errno;
}

}  // namespace neottia::repository_store
