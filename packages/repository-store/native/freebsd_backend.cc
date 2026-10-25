#include "platform_backend.h"

#include <cerrno>
#include <fcntl.h>
#include <sys/mount.h>
#include <sys/stat.h>
#include <unistd.h>

namespace neottia::repository_store {
namespace {

int Sync(int descriptor) {
  int result;
  do {
    result = fsync(descriptor);
  } while (result != 0 && errno == EINTR);
  return result == 0 ? 0 : errno;
}

int SupportsRequiredDurability(const char* path, bool* supported) {
  const int descriptor = open(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (descriptor == -1) return errno;
  const int sync_error = Sync(descriptor);
  const int close_error = close(descriptor) == 0 ? 0 : errno;
  if (sync_error == EINVAL || sync_error == ENOTSUP || sync_error == EOPNOTSUPP) {
    *supported = false;
    return 0;
  }
  return sync_error != 0 ? sync_error : close_error;
}

}  // namespace

const char* Platform() { return "freebsd"; }

int RenameNoReplace(const char* source, const char* destination) {
  struct stat source_state;
  if (lstat(source, &source_state) != 0) return errno;
  // FreeBSD 14 has no native no-replace directory rename. Repository Store
  // therefore uses a regular-file authority lease on this backend.
  if (!S_ISREG(source_state.st_mode) || source_state.st_nlink != 1) return EOPNOTSUPP;
  if (link(source, destination) != 0) return errno;
  if (unlink(source) == 0) return 0;

  const int unlink_error = errno;
  if (unlink_error == ENOENT) {
    // Another process can finish a recognized interrupted publication by
    // removing the source name. The move still succeeded when the published
    // destination is the original inode.
    struct stat published_state;
    if (lstat(destination, &published_state) == 0 && published_state.st_dev == source_state.st_dev &&
        published_state.st_ino == source_state.st_ino)
      return 0;
  }
  // Roll back the new name when source cleanup fails. A process death between
  // link and unlink leaves two names for one inode; higher-level recovery
  // normalizes recognized package-owned states and otherwise fails closed.
  if (unlink(destination) != 0) return EIO;
  return unlink_error;
}

int InspectLocalPath(const char* path, LocalPathInspection* inspection) {
  struct statfs filesystem;
  if (statfs(path, &filesystem) != 0) return errno;
  inspection->filesystem_type = filesystem.f_fstypename;
  inspection->local = (filesystem.f_flags & MNT_LOCAL) != 0;
  inspection->writable = (filesystem.f_flags & MNT_RDONLY) == 0;
  if (inspection->filesystem_type != "ufs" || !inspection->local || !inspection->writable) return 0;

  // FreeBSD reports st_birthtim.tv_sec == -1 for UFS1 and reads the stored
  // birth time for UFS2. This rejects UFS1 without reading the backing device.
  struct stat state;
  if (lstat(path, &state) != 0) return errno;
  if (state.st_birthtim.tv_sec == -1) return 0;

  inspection->certified = true;
  inspection->hard_links = true;
  inspection->stable_identity = true;
  inspection->atomic_no_replace = true;
  bool durability = false;
  const int durability_error = SupportsRequiredDurability(path, &durability);
  if (durability_error != 0) return durability_error;
  inspection->durability = durability;
  return 0;
}

int SupportsLocalPath(const char* path, bool* supported) {
  LocalPathInspection inspection;
  const int error = InspectLocalPath(path, &inspection);
  if (error != 0) return error;
  *supported = inspection.filesystem_type == "ufs" && inspection.local && inspection.writable &&
               inspection.hard_links && inspection.stable_identity && inspection.atomic_no_replace &&
               inspection.durability;
  return 0;
}

int SyncDescriptor(int descriptor) { return Sync(descriptor); }

}  // namespace neottia::repository_store
