import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("serializes plain fields and numbers", () => {
    expect(toCsv(["Tên", "Giá trị"], [["alpha", 42]])).toBe(
      "Tên,Giá trị\r\nalpha,42"
    );
  });

  it("quotes fields containing commas", () => {
    expect(toCsv(["Ghi chú"], [["Duyệt, sau khi đối chiếu"]])).toBe(
      'Ghi chú\r\n"Duyệt, sau khi đối chiếu"'
    );
  });

  it("doubles quotes inside quoted fields", () => {
    expect(toCsv(["Ghi chú"], [['Đã nói "đồng ý"']])).toBe(
      'Ghi chú\r\n"Đã nói ""đồng ý"""'
    );
  });

  it("quotes fields containing newlines", () => {
    expect(toCsv(["Ghi chú"], [["Dòng một\nDòng hai"]])).toBe(
      'Ghi chú\r\n"Dòng một\nDòng hai"'
    );
  });

  it("serializes null as an empty field", () => {
    expect(toCsv(["Mã", "Ghi chú"], [["txn_1", null]])).toBe(
      "Mã,Ghi chú\r\ntxn_1,"
    );
  });
});
