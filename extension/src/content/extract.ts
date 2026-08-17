import { extractReadable } from "../readability";

(globalThis as unknown as { __DOSSIER_EXTRACT__: unknown }).__DOSSIER_EXTRACT__ =
  extractReadable(document, location.href);
