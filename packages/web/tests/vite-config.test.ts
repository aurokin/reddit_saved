import { describe, expect, test } from "bun:test";
import config from "../vite.config";

describe("vite config", () => {
  test("binds the dev server to loopback only", () => {
    expect(config.server?.host).toBe("127.0.0.1");
    expect(config.server?.proxy?.["/api"]).toMatchObject({
      target: "http://127.0.0.1:3001",
    });
  });
});
