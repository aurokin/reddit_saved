import { GlobalRegistrator } from "@happy-dom/global-registrator";

const nativeWebApis = {
  fetch: globalThis.fetch,
  Request: globalThis.Request,
  Response: globalThis.Response,
  Headers: globalThis.Headers,
  FormData: globalThis.FormData,
  Blob: globalThis.Blob,
  File: globalThis.File,
  URL: globalThis.URL,
  URLSearchParams: globalThis.URLSearchParams,
  AbortController: globalThis.AbortController,
  AbortSignal: globalThis.AbortSignal,
  ReadableStream: globalThis.ReadableStream,
  WritableStream: globalThis.WritableStream,
  TransformStream: globalThis.TransformStream,
};

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register();

  for (const [key, value] of Object.entries(nativeWebApis)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
}

// Register cleanup from @testing-library/react AFTER happy-dom is registered,
// using a dynamic import so ESM hoisting doesn't load the module too early.
const { cleanup } = await import("@testing-library/react");
const { afterEach } = await import("bun:test");
afterEach(() => {
  cleanup();
});
