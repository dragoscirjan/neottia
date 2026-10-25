#include "platform_backend.h"

#define WIN32_LEAN_AND_MEAN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

#include <cerrno>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <cwchar>
#include <string>
#include <vector>

namespace neottia::repository_store {
namespace {

int WindowsError(DWORD error) {
  switch (error) {
    case ERROR_FILE_EXISTS:
    case ERROR_ALREADY_EXISTS:
      return EEXIST;
    case ERROR_FILE_NOT_FOUND:
    case ERROR_PATH_NOT_FOUND:
      return ENOENT;
    case ERROR_NOT_SAME_DEVICE:
      return EXDEV;
    case ERROR_ACCESS_DENIED:
      return EACCES;
    case ERROR_SHARING_VIOLATION:
    case ERROR_LOCK_VIOLATION:
      return EBUSY;
    case ERROR_INVALID_HANDLE:
      return EBADF;
    case ERROR_CALL_NOT_IMPLEMENTED:
      return ENOSYS;
    case ERROR_NOT_SUPPORTED:
      return ENOTSUP;
    case ERROR_INVALID_NAME:
    case ERROR_BAD_PATHNAME:
    case ERROR_INVALID_PARAMETER:
      return EINVAL;
    default:
      return EIO;
  }
}

int Utf8Path(const char* path, std::wstring* output) {
  if (path == nullptr) return EINVAL;
  const int required =
      MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path, -1, nullptr, 0);
  if (required == 0) return WindowsError(GetLastError());
  std::vector<wchar_t> buffer(static_cast<std::size_t>(required));
  if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path, -1,
                          buffer.data(), required) == 0)
    return WindowsError(GetLastError());
  output->assign(buffer.data());
  return 0;
}

int AbsolutePath(const char* path, std::wstring* output) {
  std::wstring decoded;
  const int decode_error = Utf8Path(path, &decoded);
  if (decode_error != 0) return decode_error;
  const DWORD required = GetFullPathNameW(decoded.c_str(), 0, nullptr, nullptr);
  if (required == 0) return WindowsError(GetLastError());
  std::vector<wchar_t> buffer(static_cast<std::size_t>(required));
  const DWORD copied =
      GetFullPathNameW(decoded.c_str(), required, buffer.data(), nullptr);
  if (copied == 0 || copied >= required)
    return copied == 0 ? WindowsError(GetLastError()) : EINVAL;
  output->assign(buffer.data(), copied);
  return 0;
}

std::wstring ExtendedPath(const std::wstring& path) {
  if (path.rfind(L"\\\\?\\", 0) == 0) return path;
  if (path.rfind(L"\\\\", 0) == 0) return L"\\\\?\\UNC\\" + path.substr(2);
  return L"\\\\?\\" + path;
}

bool IsNtfs(const wchar_t* filesystem_name) {
  return _wcsicmp(filesystem_name, L"NTFS") == 0;
}

int Utf8Text(const wchar_t* value, std::string* output) {
  const int required = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value, -1, nullptr, 0, nullptr, nullptr);
  if (required == 0) return WindowsError(GetLastError());
  std::vector<char> buffer(static_cast<std::size_t>(required));
  if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value, -1, buffer.data(), required, nullptr, nullptr) == 0)
    return WindowsError(GetLastError());
  output->assign(buffer.data());
  return 0;
}

}  // namespace

const char* Platform() { return "win32"; }

int RenameNoReplace(const char* source, const char* destination) {
  std::wstring source_path;
  int error = AbsolutePath(source, &source_path);
  if (error != 0) return error;
  std::wstring destination_path;
  error = AbsolutePath(destination, &destination_path);
  if (error != 0) return error;

  const std::wstring extended_source = ExtendedPath(source_path);
  const std::wstring extended_destination = ExtendedPath(destination_path);
  HANDLE handle =
      CreateFileW(extended_source.c_str(), DELETE | FILE_READ_ATTRIBUTES,
                  FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                  nullptr, OPEN_EXISTING,
                  FILE_ATTRIBUTE_NORMAL | FILE_FLAG_BACKUP_SEMANTICS |
                      FILE_FLAG_OPEN_REPARSE_POINT,
                  nullptr);
  if (handle == INVALID_HANDLE_VALUE) return WindowsError(GetLastError());

  FILE_ATTRIBUTE_TAG_INFO attributes = {};
  if (!GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &attributes,
                                    sizeof(attributes))) {
    error = WindowsError(GetLastError());
    CloseHandle(handle);
    return error;
  }
  if ((attributes.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0) {
    CloseHandle(handle);
    return EINVAL;
  }

  const std::size_t name_bytes = extended_destination.size() * sizeof(wchar_t);
  if (name_bytes >
      static_cast<std::size_t>(MAXDWORD) - sizeof(FILE_RENAME_INFO)) {
    CloseHandle(handle);
    return EINVAL;
  }
  std::vector<std::uint8_t> storage(sizeof(FILE_RENAME_INFO) + name_bytes);
  auto* rename = reinterpret_cast<FILE_RENAME_INFO*>(storage.data());
  rename->Flags = 0;
  rename->RootDirectory = nullptr;
  rename->FileNameLength = static_cast<DWORD>(name_bytes);
  std::memcpy(rename->FileName, extended_destination.data(), name_bytes);

  if (!SetFileInformationByHandle(handle, FileRenameInfoEx, rename,
                                  static_cast<DWORD>(storage.size()))) {
    error = WindowsError(GetLastError());
    CloseHandle(handle);
    return error;
  }
  if (!CloseHandle(handle)) return WindowsError(GetLastError());
  return 0;
}

int InspectLocalPath(const char* path, LocalPathInspection* inspection) {
  std::wstring absolute;
  int error = AbsolutePath(path, &absolute);
  if (error != 0) return error;

  const std::wstring extended = ExtendedPath(absolute);
  const DWORD attributes = GetFileAttributesW(extended.c_str());
  if (attributes == INVALID_FILE_ATTRIBUTES) return WindowsError(GetLastError());
  const bool reparse_point = (attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0;

  wchar_t volume_path[MAX_PATH + 1] = {};
  if (!GetVolumePathNameW(absolute.c_str(), volume_path, MAX_PATH + 1)) return WindowsError(GetLastError());
  inspection->local = GetDriveTypeW(volume_path) == DRIVE_FIXED;

  DWORD filesystem_flags = 0;
  wchar_t filesystem_name[MAX_PATH + 1] = {};
  if (!GetVolumeInformationW(volume_path, nullptr, 0, nullptr, nullptr, &filesystem_flags, filesystem_name,
                             MAX_PATH + 1))
    return WindowsError(GetLastError());
  error = Utf8Text(filesystem_name, &inspection->filesystem_type);
  if (error != 0) return error;
  inspection->writable = (filesystem_flags & FILE_READ_ONLY_VOLUME) == 0;
  const bool ntfs = IsNtfs(filesystem_name);
  inspection->certified = ntfs;
  inspection->hard_links = ntfs && (filesystem_flags & FILE_SUPPORTS_HARD_LINKS) != 0 && !reparse_point;
  inspection->stable_identity = ntfs && (filesystem_flags & FILE_SUPPORTS_OPEN_BY_FILE_ID) != 0 && !reparse_point;
  inspection->atomic_no_replace = ntfs && !reparse_point;
  inspection->durability = ntfs && inspection->local && inspection->writable && !reparse_point;
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

// Node and Bun own the Windows CRT descriptor table. The TypeScript adapter
// uses their fsyncSync implementation, which can safely reach the owning table.
int SyncDescriptor(int) { return ENOSYS; }

}  // namespace neottia::repository_store
