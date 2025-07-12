export function resolve(specifier, context, defaultResolve) {
  // If the import is for a .png file
  if (specifier.endsWith(".png")) {
    return {
      // Short-circuit the import and provide a dummy module
      shortCircuit: true,
      // A data URL for a valid, empty JavaScript module
      url: "data:text/javascript,export default {};",
    };
  }

  // Let Node's default loader handle all other files
  return defaultResolve(specifier, context, defaultResolve);
}
