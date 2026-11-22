/** The one part of jsdom render.test.ts uses (jsdom ships no types and @types/jsdom is not in the workspace). */
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string);
    readonly window: { DOMParser: typeof DOMParser };
  }
}
