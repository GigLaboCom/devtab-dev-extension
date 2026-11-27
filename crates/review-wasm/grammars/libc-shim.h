/*
 * Included first in every grammar built as a separate module (build.mjs passes it with -include). A grammar is compiled
 * against tree-sitter-language's wasm headers, which declare only the part of libc the tree-sitter runtime in the
 * editor module exports to grammars (tree-sitter's src/wasm-stdlib/imports.txt); a grammar file may import nothing
 * else. Two grammars use a little more of the C library than those headers have; this supplies it inside the grammar
 * itself, so nothing new is imported and no grammar source is changed:
 *
 *   tree-sitter-bash 0.23.3, src/scanner.c   isdigit() — <ctype.h> there declares only isblank and isprint;
 *   tree-sitter-cpp 0.23.4, src/scanner.c    wchar_t without <wchar.h> or <stddef.h>, and C11's static_assert macro,
 *                                            which <assert.h> there does not define.
 *
 * Natively the system's headers have all of it, so neither grammar needs a change there.
 */
#ifndef DEVTAB_GRAMMAR_LIBC_SHIM_H_
#define DEVTAB_GRAMMAR_LIBC_SHIM_H_

typedef __WCHAR_TYPE__ wchar_t;

#ifndef static_assert
#define static_assert _Static_assert
#endif

/* The C locale's isdigit; a macro over a function of our own, so it never meets a library declaration. */
static inline int devtab_isdigit(int c) { return c >= '0' && c <= '9'; }
#define isdigit(c) devtab_isdigit(c)

#endif /* DEVTAB_GRAMMAR_LIBC_SHIM_H_ */
