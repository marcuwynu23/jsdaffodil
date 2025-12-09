// CommonJS wrapper for ESM module
// Note: Since index.js is an ESM module, CommonJS cannot use require() directly.
// CommonJS users should use dynamic import() instead:
//
//   const { Daffodil } = await import('@marcuwynu23/jsdaffodil');
//
// Or wrap in an async function:
//
//   (async () => {
//     const { Daffodil } = await import('@marcuwynu23/jsdaffodil');
//     // Use Daffodil here
//   })();

// Export a helpful error message
module.exports = new Proxy({}, {
  get(target, prop) {
    throw new Error(
      `Cannot use require() with ESM module. Use dynamic import instead:\n` +
      `  const { ${prop} } = await import('@marcuwynu23/jsdaffodil');\n` +
      `Or use the ESM import syntax:\n` +
      `  import { ${prop} } from '@marcuwynu23/jsdaffodil';`
    );
  }
});
