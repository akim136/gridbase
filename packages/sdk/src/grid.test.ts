import { describe, expect, it } from "vitest";
import { GridApiError } from "./types.js";
import { GridDataClient } from "./grid.js";
import { recordIdFromFormula } from "./formula.js";

interface Call {
  url: string;
  method: string;
  body?: unknown;
  auth?: string | null;
}

/** A mock fetcher that records calls and returns a scripted JSON body. */
function mockFetcher(responder: (call: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fetcher = async (url: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers as HeadersInit);
    const call: Call = {
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(init.body as string) : undefined,
      auth: headers.get("Authorization"),
    };
    calls.push(call);
    const { status = 200, body } = responder(call);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return { fetcher, calls };
}

const rec = (id: string, fields: Record<string, unknown>) => ({ id, createdTime: "2026-01-01", fields });

describe("recordIdFromFormula", () => {
  it("extracts the id from RECORD_ID()='X'", () => {
    expect(recordIdFromFormula("RECORD_ID()='recABC'")).toBe("recABC");
    expect(recordIdFromFormula(`RECORD_ID()="recXYZ"`)).toBe("recXYZ");
  });
  it("throws on any other formula", () => {
    expect(() => recordIdFromFormula(`AND({Status}="x")`)).toThrow(/unsupported filterByFormula/);
  });
});

describe("GridDataClient", () => {
  it("sends the bearer secret and parses list records", async () => {
    const { fetcher, calls } = mockFetcher(() => ({ body: { records: [rec("rec1", { fldA: "v" })] } }));
    const client = new GridDataClient({ fetcher, origin: "https://g", secret: "s3cr3t" });
    const out = await client.list("tbl1", { fields: ["fldA"], sort: [{ field: "fldA", direction: "desc" }] });
    expect(out).toEqual([rec("rec1", { fldA: "v" })]);
    expect(calls[0]!.auth).toBe("Bearer s3cr3t");
    expect(calls[0]!.url).toContain("/v1/tables/tbl1/records");
    expect(calls[0]!.url).toContain("fields=fldA");
    expect(calls[0]!.url).toContain("sort=fldA%3Adesc");
  });

  it("translates RECORD_ID() filterByFormula into a by-id GET", async () => {
    const { fetcher, calls } = mockFetcher(() => ({ body: rec("recX", { fldA: 1 }) }));
    const client = new GridDataClient({ fetcher, origin: "https://g" });
    const out = await client.list("tbl1", { filterByFormula: "RECORD_ID()='recX'", maxRecords: 1 });
    expect(out).toEqual([rec("recX", { fldA: 1 })]);
    expect(calls[0]!.url).toBe("https://g/v1/tables/tbl1/records/recX");
  });

  it("returns [] when a by-id fetch 404s", async () => {
    const { fetcher } = mockFetcher(() => ({ status: 404, body: { error: "not found" } }));
    const client = new GridDataClient({ fetcher, origin: "https://g" });
    expect(await client.list("tbl1", { filterByFormula: "RECORD_ID()='nope'" })).toEqual([]);
  });

  it("throws on an unsupported filterByFormula", async () => {
    const { fetcher } = mockFetcher(() => ({ body: { records: [] } }));
    const client = new GridDataClient({ fetcher, origin: "https://g" });
    await expect(client.list("tbl1", { filterByFormula: `{X}="y"` })).rejects.toThrow(/unsupported/);
  });

  it("auto-paginates via the offset token", async () => {
    let n = 0;
    const { fetcher } = mockFetcher(() => {
      n += 1;
      return n === 1
        ? { body: { records: [rec("r1", {})], offset: "1" } }
        : { body: { records: [rec("r2", {})] } };
    });
    const client = new GridDataClient({ fetcher, origin: "https://g" });
    const out = await client.list("tbl1");
    expect(out.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("POSTs creates as {records:[{fields}]} and returns them", async () => {
    const { fetcher, calls } = mockFetcher((c) => ({ body: { records: (c.body as { records: unknown[] }).records.map((_, i) => rec(`new${i}`, { fldA: "x" })) } }));
    const client = new GridDataClient({ fetcher, origin: "https://g" });
    const out = await client.create("tbl1", [{ fields: { fldA: "x" } }], { typecast: true });
    expect(out[0]!.id).toBe("new0");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toEqual({ records: [{ fields: { fldA: "x" } }], typecast: true });
  });

  it("PATCHes updates with ids and requires an id", async () => {
    const { fetcher, calls } = mockFetcher(() => ({ body: { records: [rec("rec1", { fldA: "y" })] } }));
    const client = new GridDataClient({ fetcher, origin: "https://g" });
    await client.update("tbl1", [{ id: "rec1", fields: { fldA: "y" } }]);
    expect(calls[0]!.method).toBe("PATCH");
    expect(calls[0]!.body).toEqual({ records: [{ id: "rec1", fields: { fldA: "y" } }], typecast: false });
    await expect(client.update("tbl1", [{ fields: {} }])).rejects.toThrow(/needs an id/);
  });

  it("DELETEs via records[] and returns deleted ids", async () => {
    const { fetcher, calls } = mockFetcher(() => ({ body: { records: [{ id: "rec1", deleted: true }, { id: "rec2", deleted: true }] } }));
    const client = new GridDataClient({ fetcher, origin: "https://g" });
    const out = await client.remove("tbl1", ["rec1", "rec2"]);
    expect(out).toEqual(["rec1", "rec2"]);
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url).toContain("records%5B%5D=rec1");
  });

  it("throws AirtableError on a non-2xx write", async () => {
    const { fetcher } = mockFetcher(() => ({ status: 500, body: { error: "internal error" } }));
    const client = new GridDataClient({ fetcher, origin: "https://g" });
    await expect(client.create("tbl1", [{ fields: {} }])).rejects.toBeInstanceOf(GridApiError);
  });
});
