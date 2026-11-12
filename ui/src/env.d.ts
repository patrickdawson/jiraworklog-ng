/**
 * The app version from package.json, replaced at build time by Vite's
 * `define` (see vite.config.ts).
 */
declare const __APP_VERSION__: string;

/** `import text from "./file.md?raw"`: the file as a string, bundled by Vite. */
declare module "*.md?raw" {
  const content: string;
  export default content;
}
