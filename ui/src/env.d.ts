/** Replaced at build time by Vite's `define` (see vite.config.ts). */
declare const process: {
  env: { NEXT_PUBLIC_APP_VERSION: string };
};

/** `import text from "./file.md?raw"`: the file as a string, bundled by Vite. */
declare module "*.md?raw" {
  const content: string;
  export default content;
}
