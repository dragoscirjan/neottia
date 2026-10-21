{
  "targets": [
    {
      "target_name": "repository_store_native",
      "sources": ["native/backend.cc"],
      "conditions": [
        ["OS == 'linux'", { "sources": ["native/linux_backend.cc"] }],
        ["OS != 'linux'", { "sources": ["native/unsupported_backend.cc"] }]
      ],
      "cflags_cc": ["-std=c++17"]
    }
  ]
}
