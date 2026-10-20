# C++ coding

`coding-cpp` adds C++-specific guidance to the generic [`coding`](../coding/SKILL.md) workflow. It applies to C++ source, module, and header files identified by the project's build and usage context.

## Sources

- [Google C++ Style Guide](https://google.github.io/styleguide/cppguide.html)
- [C++ Core Guidelines](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines)
- [Joint Strike Fighter Air Vehicle C++ Coding Standards](https://www.stroustrup.com/JSF-AV-rules.pdf), only as a conditional supplement for safety-critical, embedded, avionics, defense-related, or explicitly governed work

The JSF standard dates from 2005 and reflects C++03-era constraints. It is not the default for general modern C++. The project's selected C++ standard, target constraints, regulatory obligations, build configuration, and safe local conventions take precedence.

## Fallback quality tools

When the project has no configured choice, the skill recommends:

- [GoogleTest](https://google.github.io/googletest/), with [CTest](https://cmake.org/cmake/help/latest/manual/ctest.1.html) when the project uses CMake
- [clang-format](https://clang.llvm.org/docs/ClangFormat.html)
- compiler warnings at the project's configured level
- [clang-tidy](https://clang.llvm.org/extra/clang-tidy/)
- [Cppcheck](https://cppcheck.sourceforge.io/)
- [AddressSanitizer](https://clang.llvm.org/docs/AddressSanitizer.html) and [UndefinedBehaviorSanitizer](https://clang.llvm.org/docs/UndefinedBehaviorSanitizer.html), plus other relevant project-supported sanitizers
- [jscpd](https://jscpd.dev/) for duplicate detection
- a dependency audit only when the project's dependency format has a mature supported audit path

Existing project configuration takes precedence. The agent must not install or reconfigure these tools without human approval. Tool support must match the selected C++ standard and target.

## Dependency contract

`coding-cpp` requires `coding`. The agent resolves it through the active harness's advertised skill names and paths, loads it first, and stops when it is unavailable. The skill does not rely on a harness-specific Skill tool.

C++ does not inherit C guidance. This skill does not load `coding-c`.

## Invocation

Pi:

```text
/skill:coding-cpp Update this C++ component and run the configured gates.
```

OpenCode:

```text
/coding-cpp Update this C++ component and run the configured gates.
```

## Files

- [`SKILL.md`](SKILL.md) contains the agent instructions.
- `README.md` documents sources, tools, and composition.

See [issue 19](https://github.com/dragoscirjan/ai/issues/19) for the implementation requirements.
