{
  "targets": [
    {
      "target_name": "repository_store_native",
      "sources": ["native/backend.cc"],
      "conditions": [
        ["OS == 'linux'", { "sources": ["native/linux_backend.cc"] }],
        ["OS == 'mac'", { "sources": ["native/macos_backend.cc"] }],
        ["OS == 'win'", { "sources": ["native/windows_backend.cc"] }],
        ["OS == 'freebsd'", { "sources": ["native/freebsd_backend.cc"] }],
        ["OS != 'linux' and OS != 'mac' and OS != 'win' and OS != 'freebsd'", { "sources": ["native/unsupported_backend.cc"] }]
      ],
      "cflags_cc": ["-std=c++17"],
      "defines": ["_WIN32_WINNT=0x0A00"],
      "xcode_settings": { "CLANG_CXX_LANGUAGE_STANDARD": "c++17" },
      "msvs_settings": { "VCCLCompilerTool": { "AdditionalOptions": ["/std:c++17"] } }
    }
  ]
}
