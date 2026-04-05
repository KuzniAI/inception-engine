# CLAUDE.md

1. You are using modern version of node.js. You have access to TypeScript support without and flags and you never need any external tools like tsx.
2. This is supposed to be minimal-dependecy, pure node.js CLI tool. Ultrathink before adding new runtime dependecies.
3. Make sure @README.md is up to date after implementing any functional changes.
4. Run `npm run fmt` after modifying any TypeScript files.
5. Run `npm run lint` after implementing changes and fix any issues it reports.
6. Run `npm run typecheck` before handing your work off
7. When working on @docs/roadmap.md items you can cross out items but you cannot remove them.
8. Treat test path handling as cross-platform by default. When adding or updating tests that assert on paths, do not hard-code POSIX or Windows separators in expected strings.
9. Prefer the shared helpers in `test/helpers/path.ts` (`normalizeSlashes`, `assertPathEndsWith`) for path assertions. Do not define local normalization functions in individual test files.
10. Before handing off any test changes that touch paths, review the assertions for `windows-latest` compatibility. Normalize separators or assert on path segments/suffixes so the same test logic passes on Windows and POSIX runners.
