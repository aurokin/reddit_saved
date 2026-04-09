import { describe, expect, test } from "bun:test";
import { deriveCodeChallenge, generateCodeVerifier } from "../src/auth/crypto";

describe("generateCodeVerifier", () => {
  test("returns base64url string of correct length for default bytes", () => {
    const verifier = generateCodeVerifier();
    // 32 bytes → ceil(32/3)*4 = 44 chars before padding removal, 43 chars after
    expect(verifier.length).toBe(43);
  });

  test("contains only base64url characters", () => {
    const verifier = generateCodeVerifier();
    expect(/^[A-Za-z0-9_-]+$/.test(verifier)).toBe(true);
  });

  test("generates unique values", () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });

  test("respects custom byte count", () => {
    const verifier = generateCodeVerifier(64);
    // 64 bytes → ceil(64*4/3) = 86 chars base64url (no padding)
    expect(verifier.length).toBe(86);
  });

  test("throws for byte count below 32", () => {
    expect(() => generateCodeVerifier(31)).toThrow();
  });

  test("throws for byte count above 96", () => {
    expect(() => generateCodeVerifier(97)).toThrow();
  });

  test("accepts minimum byte count (32)", () => {
    const v = generateCodeVerifier(32);
    // 32 bytes → ceil(32*4/3) = 43 chars base64url (no padding)
    expect(v.length).toBe(43);
  });

  test("accepts maximum byte count (96)", () => {
    const v = generateCodeVerifier(96);
    // 96 bytes → 96*4/3 = 128 chars base64url (no padding)
    expect(v.length).toBe(128);
  });
});

describe("deriveCodeChallenge", () => {
  test("returns base64url string without padding", async () => {
    const challenge = await deriveCodeChallenge("test_verifier");
    expect(/^[A-Za-z0-9_-]+$/.test(challenge)).toBe(true);
    expect(challenge).not.toContain("+");
    expect(challenge).not.toContain("/");
    expect(challenge).not.toContain("=");
  });

  test("produces consistent output for same input", async () => {
    const a = await deriveCodeChallenge("same_verifier");
    const b = await deriveCodeChallenge("same_verifier");
    expect(a).toBe(b);
  });

  test("produces different output for different input", async () => {
    const a = await deriveCodeChallenge("verifier_a");
    const b = await deriveCodeChallenge("verifier_b");
    expect(a).not.toBe(b);
  });

  // RFC 7636 Appendix B test vector
  test("matches RFC 7636 test vector", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    const challenge = await deriveCodeChallenge(verifier);
    expect(challenge).toBe(expected);
  });

  test("SHA-256 output is always 43 chars", async () => {
    // SHA-256 → 32 bytes → 43 base64url chars (no padding)
    const challenge = await deriveCodeChallenge("any_verifier_value");
    expect(challenge.length).toBe(43);
  });
});
