#include "platform_backend.h"

#include <cerrno>
#include <cstddef>
#include <cstdint>
#include <fcntl.h>
#include <stdio.h>
#include <sys/attr.h>
#include <sys/mount.h>
#include <unistd.h>

namespace neottia::repository_store {
namespace {

struct CapabilityBuffer {
  std::uint32_t length;
  vol_capabilities_attr_t capabilities;
};

bool HasCapability(const vol_capabilities_attr_t& capabilities, std::size_t group, std::uint32_t flag) {
  return (capabilities.valid[group] & flag) == flag && (capabilities.capabilities[group] & flag) == flag;
}

int SupportsRequiredDurability(const char* path, bool* supported) {
  const int descriptor = open(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (descriptor == -1) return errno;
  int sync_result;
  do {
    sync_result = fcntl(descriptor, F_FULLFSYNC, 0);
  } while (sync_result != 0 && errno == EINTR);
  if (sync_result == 0) {
    const int close_result = close(descriptor);
    return close_result == 0 ? 0 : errno;
  }
  const int sync_error = errno;
  close(descriptor);
  if (sync_error == EINVAL || sync_error == ENOTSUP || sync_error == EOPNOTSUPP) {
    *supported = false;
    return 0;
  }
  return sync_error;
}

}  // namespace

const char* Platform() { return "darwin"; }

int RenameNoReplace(const char* source, const char* destination) {
  if (renamex_np(source, destination, RENAME_EXCL) == 0) return 0;
  return errno;
}

int InspectLocalPath(const char* path, LocalPathInspection* inspection) {
  struct statfs state;
  if (statfs(path, &state) != 0) return errno;
  inspection->filesystem_type = state.f_fstypename;
  inspection->certified = inspection->filesystem_type == "apfs";
  inspection->local = (state.f_flags & MNT_LOCAL) != 0;
  inspection->writable = (state.f_flags & MNT_RDONLY) == 0;
  if (inspection->filesystem_type != "apfs" || !inspection->local || !inspection->writable) return 0;

  struct attrlist attributes = {};
  attributes.bitmapcount = ATTR_BIT_MAP_COUNT;
  attributes.volattr = ATTR_VOL_INFO | ATTR_VOL_CAPABILITIES;
  CapabilityBuffer buffer = {};
  if (getattrlist(path, &attributes, &buffer, sizeof(buffer), 0) != 0) return errno;

  inspection->stable_identity = HasCapability(
      buffer.capabilities, VOL_CAPABILITIES_FORMAT, VOL_CAP_FMT_PERSISTENTOBJECTIDS);
  inspection->hard_links = HasCapability(buffer.capabilities, VOL_CAPABILITIES_FORMAT, VOL_CAP_FMT_HARDLINKS);
  inspection->atomic_no_replace =
      HasCapability(buffer.capabilities, VOL_CAPABILITIES_INTERFACES, VOL_CAP_INT_RENAME_EXCL);
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
  *supported = inspection.filesystem_type == "apfs" && inspection.local && inspection.writable &&
               inspection.hard_links && inspection.stable_identity && inspection.atomic_no_replace &&
               inspection.durability;
  return 0;
}

int SyncDescriptor(int descriptor) {
  int result;
  do {
    result = fcntl(descriptor, F_FULLFSYNC, 0);
  } while (result != 0 && errno == EINTR);
  return result == 0 ? 0 : errno;
}

}  // namespace neottia::repository_store
