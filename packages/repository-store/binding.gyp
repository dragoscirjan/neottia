{
  "targets": [
    {
      "target_name": "repository_store_native",
      "sources": ["native/backend.cc"],
      "conditions": [
        ["OS == 'linux'", { "sources": ["native/linux_backend.cc"] }],
        ["OS == 'mac'", { "sources": ["native/macos_backend.cc"] }],
        ["OS != 'linux' and OS != 'mac'", { "sources": ["native/unsupported_backend.cc"] }]
      ],
      "cflags_cc": ["-std=c++17"],
      "xcode_settings": { "CLANG_CXX_LANGUAGE_STANDARD": "c++17" }
    }
  ]
}
