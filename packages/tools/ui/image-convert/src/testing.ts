/**
 * Samples of our own for the component's tests: the 8 × 8 gradient PNG of the logic's fixtures (written by a script),
 * and the start of a JPEG whose SOF claims 30,000 × 30,000 pixels (the bound on pixels, §5.2).
 */
export const PNG_8X8_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAgUlEQVR4nBXOQREAQAjDQKQgBSlIqRSkIAUnvdxzZ/JIRMgZcoXcIQsPXnw4IuVMuVLulIUHL778QclZcpXcJQsPXnz1g5az5Wq5WxYevPj6B+JBPIgH8YAHLz79YHgYHoaH4QEPXnzzg+VheVgelgc8ePHtD46H4+F4OB7w4MWHH/qRl8FweERHAAAAAElFTkSuQmCC';

/** SOI and a SOF0 of 30,000 × 30,000, three components. */
export const HUGE_JPEG_HEADER_BASE64 = btoa(
  String.fromCharCode(0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0x75, 0x30, 0x75, 0x30, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1),
);
