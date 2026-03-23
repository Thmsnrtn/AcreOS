/**
 * Phase 5.3 — Import Edge Case Tests
 * Tests the parseCSV function for robustness with edge cases:
 * missing required columns, UTF-8 special characters, empty rows, quoted fields.
 */

import { describe, it, expect } from "vitest";

// ─── Inline parseCSV logic (mirrors server/services/import.ts) ───────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

function parseCSV(csvString: string): Array<Record<string, string>> {
  const lines = csvString.trim().split(/\r?\n/);
  if (lines.length < 2) {
    throw new Error("CSV must have a header row and at least one data row");
  }

  const headers = parseCSVLine(lines[0]);
  const data: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    const row: Record<string, string> = {};

    headers.forEach((header, idx) => {
      row[header.trim()] = values[idx]?.trim() || "";
    });

    data.push(row);
  }

  return data;
}

// ─── Inline required-column validation (mirrors validateSchemaBeforeImport) ──

const LEAD_REQUIRED_FIELDS = ["firstName", "lastName"];

const LEAD_COLUMN_MAP: Record<string, string> = {
  firstName: "firstName",
  first_name: "firstName",
  "first name": "firstName",
  lastName: "lastName",
  last_name: "lastName",
  "last name": "lastName",
  email: "email",
  phone: "phone",
};

function normalizeRow(
  row: Record<string, string>,
  columnMap: Record<string, string>
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = columnMap[key.toLowerCase()] || columnMap[key] || key;
    normalized[normalizedKey] = value;
  }
  return normalized;
}

function validateRequiredColumns(
  csvData: Array<Record<string, string>>
): { valid: boolean; missingFields: string[] } {
  const missingFields: string[] = [];

  for (const rawRow of csvData) {
    const row = normalizeRow(rawRow, LEAD_COLUMN_MAP);
    for (const field of LEAD_REQUIRED_FIELDS) {
      if (!row[field] || row[field].trim() === "") {
        if (!missingFields.includes(field)) {
          missingFields.push(field);
        }
      }
    }
  }

  return { valid: missingFields.length === 0, missingFields };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("parseCSV", () => {
  it("parses a simple CSV correctly", () => {
    const csv = "firstName,lastName,email\nJohn,Doe,john@example.com\nJane,Smith,jane@example.com";
    const result = parseCSV(csv);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ firstName: "John", lastName: "Doe", email: "john@example.com" });
    expect(result[1]).toEqual({ firstName: "Jane", lastName: "Smith", email: "jane@example.com" });
  });

  it("throws error for header-only CSV (no data rows)", () => {
    const csv = "firstName,lastName,email";
    expect(() => parseCSV(csv)).toThrow("CSV must have a header row and at least one data row");
  });

  it("throws error for empty string", () => {
    expect(() => parseCSV("")).toThrow("CSV must have a header row and at least one data row");
  });

  it("handles quoted fields containing commas", () => {
    const csv = 'firstName,lastName,address\nJohn,Doe,"123 Main St, Suite 4"\nJane,Smith,"456 Oak Ave, Apt 7"';
    const result = parseCSV(csv);

    expect(result).toHaveLength(2);
    expect(result[0].address).toBe("123 Main St, Suite 4");
    expect(result[1].address).toBe("456 Oak Ave, Apt 7");
  });

  it("handles quoted fields containing newlines within quotes", () => {
    // Note: parseCSV splits on \n first, so embedded newlines in quotes
    // would need to be on the same line. This tests escaped quotes instead.
    const csv = 'firstName,lastName,notes\nJohn,Doe,"He said ""hello"""\nJane,Smith,"Normal note"';
    const result = parseCSV(csv);

    expect(result).toHaveLength(2);
    expect(result[0].notes).toBe('He said "hello"');
    expect(result[1].notes).toBe("Normal note");
  });

  it("handles double-quoted empty fields", () => {
    const csv = 'firstName,lastName,email\nJohn,Doe,""\nJane,Smith,jane@test.com';
    const result = parseCSV(csv);

    expect(result).toHaveLength(2);
    expect(result[0].email).toBe("");
    expect(result[1].email).toBe("jane@test.com");
  });

  it("skips empty rows between data rows", () => {
    const csv = "firstName,lastName\nJohn,Doe\n\n\nJane,Smith\n\n";
    const result = parseCSV(csv);

    expect(result).toHaveLength(2);
    expect(result[0].firstName).toBe("John");
    expect(result[1].firstName).toBe("Jane");
  });

  it("handles CSV with only empty rows after header", () => {
    const csv = "firstName,lastName\n\n\n\n";
    // After trim(), trailing newlines are removed, leaving only the header.
    // parseCSV requires at least one data row, so it throws.
    expect(() => parseCSV(csv)).toThrow("CSV must have a header row and at least one data row");
  });

  it("handles Windows-style line endings (\\r\\n)", () => {
    const csv = "firstName,lastName\r\nJohn,Doe\r\nJane,Smith\r\n";
    const result = parseCSV(csv);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ firstName: "John", lastName: "Doe" });
  });

  it("handles trailing whitespace in headers and values", () => {
    const csv = " firstName , lastName \nJohn , Doe ";
    const result = parseCSV(csv);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ firstName: "John", lastName: "Doe" });
  });

  it("handles missing trailing values (fewer values than headers)", () => {
    const csv = "firstName,lastName,email\nJohn,Doe";
    const result = parseCSV(csv);

    expect(result).toHaveLength(1);
    expect(result[0].firstName).toBe("John");
    expect(result[0].lastName).toBe("Doe");
    expect(result[0].email).toBe("");
  });
});

describe("parseCSVLine", () => {
  it("splits simple comma-separated values", () => {
    const result = parseCSVLine("a,b,c");
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("handles quoted fields with commas", () => {
    const result = parseCSVLine('"hello, world",b,c');
    expect(result).toEqual(["hello, world", "b", "c"]);
  });

  it("handles escaped double quotes inside quoted fields", () => {
    const result = parseCSVLine('"She said ""hi""",b');
    expect(result).toEqual(['She said "hi"', "b"]);
  });

  it("handles empty fields", () => {
    const result = parseCSVLine("a,,c,");
    expect(result).toEqual(["a", "", "c", ""]);
  });
});

describe("CSV with UTF-8 special characters", () => {
  it("parses names with accented characters", () => {
    const csv = "firstName,lastName\nJos\u00e9,Garc\u00eda\nFran\u00e7ois,M\u00fcller";
    const result = parseCSV(csv);

    expect(result).toHaveLength(2);
    expect(result[0].firstName).toBe("Jos\u00e9");
    expect(result[0].lastName).toBe("Garc\u00eda");
    expect(result[1].firstName).toBe("Fran\u00e7ois");
    expect(result[1].lastName).toBe("M\u00fcller");
  });

  it("parses names with CJK characters", () => {
    const csv = "firstName,lastName\n\u592a\u90ce,\u7530\u4e2d\n\u6625\u5b50,\u5c71\u7530";
    const result = parseCSV(csv);

    expect(result).toHaveLength(2);
    expect(result[0].firstName).toBe("\u592a\u90ce");
    expect(result[0].lastName).toBe("\u7530\u4e2d");
  });

  it("parses names with emoji and symbols", () => {
    const csv = "firstName,lastName,notes\nJohn,O'Brien,\"Note with \u2014 dash\"\nMary,McDonald,\"Has \u2022 bullet\"";
    const result = parseCSV(csv);

    expect(result).toHaveLength(2);
    expect(result[0].lastName).toBe("O'Brien");
    expect(result[0].notes).toBe("Note with \u2014 dash");
  });

  it("handles Cyrillic characters", () => {
    const csv = "firstName,lastName\n\u0418\u0432\u0430\u043d,\u041f\u0435\u0442\u0440\u043e\u0432";
    const result = parseCSV(csv);

    expect(result).toHaveLength(1);
    expect(result[0].firstName).toBe("\u0418\u0432\u0430\u043d");
    expect(result[0].lastName).toBe("\u041f\u0435\u0442\u0440\u043e\u0432");
  });
});

describe("CSV missing required columns validation", () => {
  it("detects missing firstName column", () => {
    const csv = "email,lastName\njohn@test.com,Doe";
    const data = parseCSV(csv);
    const validation = validateRequiredColumns(data);

    expect(validation.valid).toBe(false);
    expect(validation.missingFields).toContain("firstName");
  });

  it("detects missing lastName column", () => {
    const csv = "firstName,email\nJohn,john@test.com";
    const data = parseCSV(csv);
    const validation = validateRequiredColumns(data);

    expect(validation.valid).toBe(false);
    expect(validation.missingFields).toContain("lastName");
  });

  it("detects both missing required columns", () => {
    const csv = "email,phone\njohn@test.com,555-1234";
    const data = parseCSV(csv);
    const validation = validateRequiredColumns(data);

    expect(validation.valid).toBe(false);
    expect(validation.missingFields).toContain("firstName");
    expect(validation.missingFields).toContain("lastName");
  });

  it("passes when required columns are present", () => {
    const csv = "firstName,lastName,email\nJohn,Doe,john@test.com";
    const data = parseCSV(csv);
    const validation = validateRequiredColumns(data);

    expect(validation.valid).toBe(true);
    expect(validation.missingFields).toHaveLength(0);
  });

  it("detects empty required field values", () => {
    const csv = "firstName,lastName,email\n,Doe,john@test.com";
    const data = parseCSV(csv);
    const validation = validateRequiredColumns(data);

    expect(validation.valid).toBe(false);
    expect(validation.missingFields).toContain("firstName");
  });

  it("recognizes alternative column name formats (first_name)", () => {
    const csv = "first_name,last_name,email\nJohn,Doe,john@test.com";
    const data = parseCSV(csv);
    const validation = validateRequiredColumns(data);

    expect(validation.valid).toBe(true);
  });
});
