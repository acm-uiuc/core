export function getCurrentRevision() {
  return import.meta.env.VITE_BUILD_HASH
    ? import.meta.env.VITE_BUILD_HASH
    : "unknown";
}
