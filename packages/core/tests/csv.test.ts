import { describe, expect, test } from "bun:test";
import { parseCsv, parseCsvRecords } from "../src/import/csv";

describe("parseCsv", () => {
  const cases: Array<{ name: string; input: string; expected: string[][] }> = [
    {
      name: "simple rows",
      input: "a,b,c\n1,2,3",
      expected: [
        ["a", "b", "c"],
        ["1", "2", "3"],
      ],
    },
    {
      name: "trailing newline produces no empty row",
      input: "a,b\n1,2\n",
      expected: [
        ["a", "b"],
        ["1", "2"],
      ],
    },
    {
      name: "CRLF line endings",
      input: "a,b\r\n1,2\r\n",
      expected: [
        ["a", "b"],
        ["1", "2"],
      ],
    },
    {
      name: "quoted field with embedded comma",
      input: 'a,"b,c",d',
      expected: [["a", "b,c", "d"]],
    },
    {
      name: "quoted field with embedded LF newline",
      input: 'a,"line1\nline2",c',
      expected: [["a", "line1\nline2", "c"]],
    },
    {
      name: "quoted field with embedded CRLF newline",
      input: 'a,"line1\r\nline2",c',
      expected: [["a", "line1\r\nline2", "c"]],
    },
    {
      name: "doubled quotes inside quoted field",
      input: '"she said ""hi""",b',
      expected: [['she said "hi"', "b"]],
    },
    {
      name: "field that is only a doubled quote",
      input: '""""',
      expected: [['"']],
    },
    {
      name: "empty quoted field",
      input: '"",b',
      expected: [["", "b"]],
    },
    {
      name: "empty fields",
      input: "a,,c\n,,",
      expected: [
        ["a", "", "c"],
        ["", "", ""],
      ],
    },
    {
      name: "empty input",
      input: "",
      expected: [],
    },
    {
      name: "single field",
      input: "hello",
      expected: [["hello"]],
    },
    {
      name: "quote in the middle of an unquoted field is literal",
      input: 'a,b"c,d',
      expected: [["a", 'b"c', "d"]],
    },
    {
      name: "quoted field followed by another quoted field",
      input: '"a","b"\n"c","d"',
      expected: [
        ["a", "b"],
        ["c", "d"],
      ],
    },
    {
      name: "unterminated quote runs to end of input",
      input: '"abc,def',
      expected: [["abc,def"]],
    },
    {
      name: "blank line becomes single empty-field row",
      input: "a\n\nb",
      expected: [["a"], [""], ["b"]],
    },
    {
      name: "unicode content",
      input: "emoji,✨ sparkles ✨\nsub,r/日本語",
      expected: [
        ["emoji", "✨ sparkles ✨"],
        ["sub", "r/日本語"],
      ],
    },
    {
      name: "quoted comma and newline in one field",
      input: 'id,"a, b\nand c",tail',
      expected: [["id", "a, b\nand c", "tail"]],
    },
  ];

  for (const { name, input, expected } of cases) {
    test(name, () => {
      expect(parseCsv(input)).toEqual(expected);
    });
  }
});

describe("parseCsvRecords", () => {
  test("keys fields by header name", () => {
    const records = parseCsvRecords("id,permalink\nabc,https://x/1\ndef,https://x/2\n");
    expect(records).toEqual([
      { id: "abc", permalink: "https://x/1" },
      { id: "def", permalink: "https://x/2" },
    ]);
  });

  test("column order does not matter", () => {
    const records = parseCsvRecords("permalink,id\nhttps://x/1,abc");
    expect(records[0].id).toBe("abc");
    expect(records[0].permalink).toBe("https://x/1");
  });

  test("short rows fill missing columns with empty strings", () => {
    const records = parseCsvRecords("id,permalink,direction\nabc");
    expect(records).toEqual([{ id: "abc", permalink: "", direction: "" }]);
  });

  test("blank lines are skipped", () => {
    const records = parseCsvRecords("id\nabc\n\ndef\n");
    expect(records).toEqual([{ id: "abc" }, { id: "def" }]);
  });

  test("empty input yields no records", () => {
    expect(parseCsvRecords("")).toEqual([]);
  });

  test("header-only input yields no records", () => {
    expect(parseCsvRecords("id,permalink\n")).toEqual([]);
  });

  test("quoted bodies with commas and newlines survive", () => {
    const records = parseCsvRecords('id,body\nabc,"first line,\nsecond ""quoted"" line"');
    expect(records[0].body).toBe('first line,\nsecond "quoted" line');
  });
});
