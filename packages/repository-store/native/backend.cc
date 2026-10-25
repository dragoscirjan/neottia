#include <node_api.h>

#include <cerrno>
#include <cstdint>
#include <cstring>
#include <string>
#include <utility>

#include "platform_backend.h"

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
    case EBUSY:
      return "EBUSY";
    case EBADF:
      return "EBADF";
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

bool ReadPath(napi_env env, napi_value value, std::string* output) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) return false;
  std::string path(length + 1, '\0');
  size_t copied = 0;
  if (napi_get_value_string_utf8(env, value, path.data(), length + 1, &copied) != napi_ok) return false;
  path.resize(copied);
  *output = std::move(path);
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
  std::string source;
  std::string destination;
  if (!ReadPath(env, argv[0], &source) || !ReadPath(env, argv[1], &destination)) {
    napi_throw_type_error(env, nullptr, "renameNoReplace paths must be strings");
    return nullptr;
  }
  const int error = neottia::repository_store::RenameNoReplace(source.c_str(), destination.c_str());
  if (error != 0) {
    ThrowErrno(env, error);
    return nullptr;
  }
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

void SetBooleanProperty(napi_env env, napi_value object, const char* name, bool value) {
  napi_value property;
  napi_get_boolean(env, value, &property);
  napi_set_named_property(env, object, name, property);
}

napi_value InspectLocalPath(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  std::string path;
  if (argc != 1 || !ReadPath(env, argv[0], &path)) {
    napi_throw_type_error(env, nullptr, "inspectLocalPath requires one path");
    return nullptr;
  }
  neottia::repository_store::LocalPathInspection inspection;
  const int error = neottia::repository_store::InspectLocalPath(path.c_str(), &inspection);
  if (error != 0) {
    ThrowErrno(env, error);
    return nullptr;
  }
  napi_value result;
  napi_create_object(env, &result);
  napi_value filesystem_type;
  napi_create_string_utf8(env, inspection.filesystem_type.c_str(), NAPI_AUTO_LENGTH, &filesystem_type);
  napi_set_named_property(env, result, "filesystemType", filesystem_type);
  SetBooleanProperty(env, result, "certified", inspection.certified);
  SetBooleanProperty(env, result, "local", inspection.local);
  SetBooleanProperty(env, result, "writable", inspection.writable);
  SetBooleanProperty(env, result, "hardLinks", inspection.hard_links);
  SetBooleanProperty(env, result, "stableIdentity", inspection.stable_identity);
  SetBooleanProperty(env, result, "atomicNoReplace", inspection.atomic_no_replace);
  SetBooleanProperty(env, result, "durability", inspection.durability);
  return result;
}

napi_value SupportsLocalPath(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  std::string path;
  if (argc != 1 || !ReadPath(env, argv[0], &path)) {
    napi_throw_type_error(env, nullptr, "supportsLocalPath requires one path");
    return nullptr;
  }
  bool supported = false;
  const int error = neottia::repository_store::SupportsLocalPath(path.c_str(), &supported);
  if (error != 0) {
    ThrowErrno(env, error);
    return nullptr;
  }
  napi_value result;
  napi_get_boolean(env, supported, &result);
  return result;
}

napi_value SyncDescriptor(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  std::int32_t descriptor = -1;
  if (argc != 1 || napi_get_value_int32(env, argv[0], &descriptor) != napi_ok || descriptor < 0) {
    napi_throw_type_error(env, nullptr, "syncDescriptor requires one non-negative file descriptor");
    return nullptr;
  }
  const int error = neottia::repository_store::SyncDescriptor(descriptor);
  if (error != 0) {
    ThrowErrno(env, error);
    return nullptr;
  }
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value Initialize(napi_env env, napi_value exports) {
  napi_value platform;
  napi_create_string_utf8(env, neottia::repository_store::Platform(), NAPI_AUTO_LENGTH, &platform);
  napi_set_named_property(env, exports, "platform", platform);
  napi_value rename_function;
  napi_create_function(env, "renameNoReplace", NAPI_AUTO_LENGTH, RenameNoReplace, nullptr, &rename_function);
  napi_set_named_property(env, exports, "renameNoReplace", rename_function);
  napi_value inspect_function;
  napi_create_function(env, "inspectLocalPath", NAPI_AUTO_LENGTH, InspectLocalPath, nullptr, &inspect_function);
  napi_set_named_property(env, exports, "inspectLocalPath", inspect_function);
  napi_value supports_function;
  napi_create_function(env, "supportsLocalPath", NAPI_AUTO_LENGTH, SupportsLocalPath, nullptr, &supports_function);
  napi_set_named_property(env, exports, "supportsLocalPath", supports_function);
  napi_value sync_function;
  napi_create_function(env, "syncDescriptor", NAPI_AUTO_LENGTH, SyncDescriptor, nullptr, &sync_function);
  napi_set_named_property(env, exports, "syncDescriptor", sync_function);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)
