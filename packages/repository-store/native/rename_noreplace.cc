#include <node_api.h>

#include <cerrno>
#include <cstring>

#ifdef __linux__
#include <fcntl.h>
#include <linux/fs.h>
#include <linux/magic.h>
#include <stdio.h>
#include <sys/vfs.h>
#endif

namespace {

const char* ErrnoCode(int value) {
  switch (value) {
    case EEXIST:
      return "EEXIST";
    case ENOENT:
      return "ENOENT";
    case EXDEV:
      return "EXDEV";
    case ENOSYS:
      return "ENOSYS";
    case ENOTSUP:
      return "ENOTSUP";
    case EINVAL:
      return "EINVAL";
    case EPERM:
      return "EPERM";
    case EACCES:
      return "EACCES";
    default:
      return "EIO";
  }
}

void ThrowErrno(napi_env env, int value) {
  napi_value message;
  napi_create_string_utf8(env, std::strerror(value), NAPI_AUTO_LENGTH, &message);
  napi_value error;
  napi_create_error(env, nullptr, message, &error);
  napi_value code;
  napi_create_string_utf8(env, ErrnoCode(value), NAPI_AUTO_LENGTH, &code);
  napi_set_named_property(env, error, "code", code);
  napi_throw(env, error);
}

bool ReadPath(napi_env env, napi_value value, char** output) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) return false;
  *output = new char[length + 1];
  size_t copied = 0;
  if (napi_get_value_string_utf8(env, value, *output, length + 1, &copied) != napi_ok) {
    delete[] *output;
    *output = nullptr;
    return false;
  }
  return true;
}

napi_value RenameNoReplace(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 2) {
    napi_throw_type_error(env, nullptr, "renameNoReplace requires source and destination paths");
    return nullptr;
  }
  char* source = nullptr;
  char* destination = nullptr;
  if (!ReadPath(env, argv[0], &source) || !ReadPath(env, argv[1], &destination)) {
    delete[] source;
    delete[] destination;
    napi_throw_type_error(env, nullptr, "renameNoReplace paths must be strings");
    return nullptr;
  }
#ifdef __linux__
  const int result = renameat2(AT_FDCWD, source, AT_FDCWD, destination, RENAME_NOREPLACE);
  const int saved_errno = errno;
#else
  const int result = -1;
  const int saved_errno = ENOSYS;
#endif
  delete[] source;
  delete[] destination;
  if (result != 0) {
    ThrowErrno(env, saved_errno);
    return nullptr;
  }
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value SupportsLocalPath(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  char* path = nullptr;
  if (argc != 1 || !ReadPath(env, argv[0], &path)) {
    napi_throw_type_error(env, nullptr, "supportsLocalPath requires one path");
    return nullptr;
  }
  bool supported = false;
#ifdef __linux__
  struct statfs state;
  if (statfs(path, &state) != 0) {
    const int saved_errno = errno;
    delete[] path;
    ThrowErrno(env, saved_errno);
    return nullptr;
  }
  switch (state.f_type) {
    case EXT4_SUPER_MAGIC:
    case XFS_SUPER_MAGIC:
    case BTRFS_SUPER_MAGIC:
    case TMPFS_MAGIC:
    case OVERLAYFS_SUPER_MAGIC:
      supported = true;
      break;
    default:
      supported = false;
  }
#endif
  delete[] path;
  napi_value result;
  napi_get_boolean(env, supported, &result);
  return result;
}

napi_value Initialize(napi_env env, napi_value exports) {
  napi_value rename_function;
  napi_create_function(env, "renameNoReplace", NAPI_AUTO_LENGTH, RenameNoReplace, nullptr, &rename_function);
  napi_set_named_property(env, exports, "renameNoReplace", rename_function);
  napi_value supports_function;
  napi_create_function(env, "supportsLocalPath", NAPI_AUTO_LENGTH, SupportsLocalPath, nullptr, &supports_function);
  napi_set_named_property(env, exports, "supportsLocalPath", supports_function);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)
