// A stylesheet imported by URL (Vite emits it as a file of the build and gives its address): the preview frame's.
declare module '*.css?url' {
  const url: string;
  export default url;
}

// The same stylesheet as text: its test holds it to the @workspace/dna contract.
declare module '*.css?raw' {
  const text: string;
  export default text;
}
