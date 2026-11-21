/**
 * What jsdom lacks and the pages use — `Blob.text()` / `arrayBuffer()` (files read by «Compare code», history blobs),
 * the `scrollIntoView` and pointer capture Radix calls — and Testing Library's async timeout raised to 4 s (the first
 * test that opens a section loads the shell, the tool history and the tool as lazy chunks): the same setup the UI kit
 * gives the tools' tests.
 */
import '@workspace/ui/testing';
