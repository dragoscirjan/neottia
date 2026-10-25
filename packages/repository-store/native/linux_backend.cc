#include "platform_backend.h"

#include <cerrno>
#include <fcntl.h>
#include <linux/fs.h>
#include <linux/magic.h>
#include <cstdio>
#include <sys/statvfs.h>
#include <sys/vfs.h>
#include <unistd.h>

namespace neottia::repository_store {
namespace {

constexpr long kCifsMagic = 0xff534d42L;
constexpr long kCephMagic = 0x00c36400L;
constexpr long kNinePMagic = 0x01021997L;

const char* FilesystemType(long type) {
  switch (type) {
    case EXT4_SUPER_MAGIC:
      return "ext4";
    case XFS_SUPER_MAGIC:
      return "xfs";
    case BTRFS_SUPER_MAGIC:
      return "btrfs";
    case TMPFS_MAGIC:
      return "tmpfs";
    case OVERLAYFS_SUPER_MAGIC:
      return "overlay";
    case NFS_SUPER_MAGIC:
      return "nfs";
    case SMB_SUPER_MAGIC:
      return "smb";
    case kCifsMagic:
      return "cifs";
    case kCephMagic:
      return "ceph";
    case kNinePMagic:
      return "9p";
    default:
      return nullptr;
  }
}

bool IsCertifiedFilesystem(long type) {
  return type == EXT4_SUPER_MAGIC || type == XFS_SUPER_MAGIC || type == BTRFS_SUPER_MAGIC || type == TMPFS_MAGIC ||
         type == OVERLAYFS_SUPER_MAGIC;
}

bool IsKnownRemoteFilesystem(long type) {
  return type == NFS_SUPER_MAGIC || type == SMB_SUPER_MAGIC || type == kCifsMagic || type == kCephMagic ||
         type == kNinePMagic;
}

}  // namespace

const char* Platform() { return "linux"; }

int RenameNoReplace(const char* source, const char* destination) {
  if (renameat2(AT_FDCWD, source, AT_FDCWD, destination, RENAME_NOREPLACE) == 0) return 0;
  return errno;
}

int InspectLocalPath(const char* path, LocalPathInspection* inspection) {
  struct statfs state;
  if (statfs(path, &state) != 0) return errno;
  const char* name = FilesystemType(state.f_type);
  if (name == nullptr) {
    char value[32];
    std::snprintf(value, sizeof(value), "0x%lx", static_cast<unsigned long>(state.f_type));
    inspection->filesystem_type = value;
  } else {
    inspection->filesystem_type = name;
  }
  const bool certified = IsCertifiedFilesystem(state.f_type);
  inspection->certified = certified;
  inspection->local = !IsKnownRemoteFilesystem(state.f_type);
  inspection->writable = (state.f_flags & ST_RDONLY) == 0;
  inspection->hard_links = certified;
  inspection->stable_identity = certified;
  inspection->atomic_no_replace = certified;
  inspection->durability = certified;
  return 0;
}

int SupportsLocalPath(const char* path, bool* supported) {
  LocalPathInspection inspection;
  const int error = InspectLocalPath(path, &inspection);
  if (error != 0) return error;
  *supported = inspection.local && inspection.writable && inspection.hard_links && inspection.stable_identity &&
               inspection.atomic_no_replace && inspection.durability;
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
