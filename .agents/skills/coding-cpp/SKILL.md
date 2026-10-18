---
name: coding-cpp
description: Write, refactor, review, or test modern C++ source and headers with RAII, explicit ownership, value semantics, safe generic code, target portability, and project-first quality gates. Use for C++ source, module, and header files identified by project and build context.
compatibility: Requires the coding skill and the C++ compiler, standard library, build system, target, and analysis tools selected by the project.
metadata:
  author: dragoscirjan
  version: "1.0"
  opencode/slash: "true"
---

# C++ coding

Apply the generic `coding` workflow, then apply the C++-specific rules in this skill. Do not load or inherit `coding-c`; C++ is a separate language with different idioms and safety mechanisms.

## Load the dependency

Locate the advertised `coding` skill by exact name and path. If it is not already loaded, read its `SKILL.md` before continuing.

If `coding` is unavailable, stop and ask the human to install or expose it. Do not install it automatically, copy its instructions into this skill, or assume its contents from memory.

## Confirm C++ context

Apply this skill to C++ source, module, and header extensions recognized by the project, including `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, and `.hxx`. For `.h` files and project-specific module extensions, inspect includers, build configuration, and compiler invocations instead of guessing from the extension.

Inspect the build system, compiler and linker flags, declared C++ standard, standard library, target ABI, platform support, generated sources, tests, static-analysis configuration, and CI before editing. Preserve cross-compilation, freestanding, binary-compatibility, and exception or RTTI constraints when present.

Use the [Google C++ Style Guide](https://google.github.io/styleguide/cppguide.html) and the [C++ Core Guidelines](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines) as external guidance. Safe, internally consistent project conventions take precedence.

## Write idiomatic C++

- Target the C++ standard, compilers, and standard libraries declared by the project. Do not silently raise minimum versions.
- Use RAII for every owned resource. Prefer automatic storage and standard-library types over manual allocation and cleanup.
- Prefer value semantics. Express unique or shared ownership explicitly with project-approved types; use raw pointers and references as non-owning views unless the interface clearly states otherwise.
- Follow the rule of zero. Define special member functions only when ownership or invariants require them, and keep copy and move behavior deliberate.
- Use `const`, scoped enumerations, algorithms, ranges, views, and vocabulary types when they improve clarity and are supported. Prove the lifetime of every non-owning view.
- Keep templates focused. Constrain generic code when supported, produce useful diagnostics, and avoid metaprogramming that does not remove demonstrated duplication or risk.
- Prefer type-safe language and library facilities over macros, C-style casts, sentinel values, and untagged unions.
- Follow the project's exception and error policy. Do not discard failures; preserve context without violating `noexcept` contracts.
- Preserve public APIs, ABI, symbol visibility, data layout, and observable behavior unless the approved task changes them.

## Enforce C++ safety boundaries

- Validate sizes, indexes, iterators, conversions, and arithmetic before memory access or allocation. Avoid dangling pointers, references, iterators, spans, string views, and captured objects.
- Do not introduce owning raw `new` or `delete` when RAII can express the lifetime. Match allocation and deallocation mechanisms at unavoidable low-level boundaries.
- Keep object invariants valid across construction, moves, callbacks, exceptions, and partial failure.
- Use scoped locks and project-approved synchronization. Make shared ownership and thread-safety contracts explicit; do not use `volatile` as synchronization.
- Validate untrusted data at parsing, serialization, filesystem, subprocess, network, and foreign-function boundaries.
- Minimize `unsafe`-equivalent operations such as unchecked casts, pointer arithmetic, manual storage management, and lifetime extension. Isolate and explain unavoidable uses.
- Give polymorphic base classes an appropriate destruction policy and avoid slicing.

## Apply high-assurance supplements conditionally

Use the [Joint Strike Fighter Air Vehicle C++ Coding Standards](https://www.stroustrup.com/JSF-AV-rules.pdf) only when the project is safety-critical, embedded, avionics, defense-related, or explicitly requires that standard. Treat it as a 2005 C++03-era supplement, not a general modern-C++ default. Apply contractual project and regulatory requirements first, and use modern equivalents where the governing standard permits them.

## Test and run C++ gates

Use the project's commands and configured tools first. When the project has no configured choice, ask before installing or configuring these fallbacks:

- [GoogleTest](https://google.github.io/googletest/) for unit tests, using the project's build runner and [CTest](https://cmake.org/cmake/help/latest/manual/ctest.1.html) only when the project uses CMake
- [clang-format](https://clang.llvm.org/docs/ClangFormat.html) for formatting
- compiler warnings at the project's configured level
- [clang-tidy](https://clang.llvm.org/extra/clang-tidy/) and [Cppcheck](https://cppcheck.sourceforge.io/) for complementary static analysis where their checks support the selected C++ standard and target
- [AddressSanitizer](https://clang.llvm.org/docs/AddressSanitizer.html) and [UndefinedBehaviorSanitizer](https://clang.llvm.org/docs/UndefinedBehaviorSanitizer.html), plus other project-supported sanitizers when relevant
- [jscpd](https://jscpd.dev/) as the duplicate detector when the project has no configured alternative
- dependency or package auditing only when the project's dependency format has a mature supported audit path

Test observable behavior, ownership transitions, copy and move behavior, invalid input, exception and error paths, cleanup, concurrency where relevant, and target-specific behavior. Use fuzzing or property testing when the project already supports it or the human approves adding it.

Apply only project-defined thresholds. Report every applicable gate as passed, failed, not run, or unsupported. A tool's lack of support for the selected standard, target, or dependency format is an unsupported gate, not a pass.
