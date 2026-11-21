/**
 * What jsdom lacks and the components and tools use, for their tests (a `setupFiles` entry: `@workspace/ui/testing`):
 * `Blob.text()` / `arrayBuffer()` (files and history blobs), the `scrollIntoView` Radix Select calls on its options, and
 * the pointer capture Radix calls on a press. Filled from jsdom's own FileReader; nothing here runs in a page.
 */
import { configure } from '@testing-library/react';

// `findBy…` waits 1 s by default; a lazy chunk transformed on first use beside the workspace's other test tasks has
// taken just over a second. Still far below a test's own 5 s limit.
configure({ asyncUtilTimeout: 4000 });

const read = <T>(blob: Blob, how: 'readAsText' | 'readAsArrayBuffer'): Promise<T> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as T);
    reader.onerror = () => reject(reader.error);
    reader[how](blob);
  });

if (typeof Blob !== 'undefined' && !Blob.prototype.text) {
  Blob.prototype.text = function text(this: Blob) {
    return read<string>(this, 'readAsText');
  };
}
if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return read<ArrayBuffer>(this, 'readAsArrayBuffer');
  };
}
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
}
