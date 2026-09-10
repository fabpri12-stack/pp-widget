import test from "node:test";
import assert from "node:assert/strict";
import verify from "../api/dmn/verify";
import returnHandler from "../api/dmn/return";

const venue = "6214cfdb21d4111e033a9433";
const booking = { booking_id: 123456, email: "guest@example.com", venue_id: venue, status: "complete", date: "2026-09-17T00:00:00", time: "19:00", num_people: 2, type: { id: "show" } };
const body = { reference: "DMN-123456", email: "guest@example.com", date: "2026-09-17", time: "19:00", guests: 2, type: "show", status: "complete", success: true };
function response() {
  return { code: 0, data: null as any, headers: {} as Record<string, string>, setHeader(k: string, v: string) { this.headers[k] = v; }, status(code: number) { this.code = code; return this; }, json(data: unknown) { this.data = data; return this; }, redirect(code: number, url: string) { this.code = code; this.data = url; return this; } };
}

for (const scenario of ["paid", "unpaid", "enquiry", "cancelled", "missing", "wrong email", "wrong venue", "wrong date", "wrong type", "wrong guests", "api error", "malformed", "payment lookup error"]) {
  test(`DMN verification: ${scenario}`, async (t) => {
    const previous = [process.env.DMN_APP_ID, process.env.DMN_API_KEY];
    process.env.DMN_APP_ID = "test"; process.env.DMN_API_KEY = "test";
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (input: any) => {
      calls++;
      const url = new URL(input);
      assert.equal(url.searchParams.get("booking_id"), "123456");
      assert.equal(url.searchParams.get("venue_id"), venue);
      const paid = url.searchParams.get("notifications") === "deposit_paid";
      if (scenario === "api error" || (paid && scenario === "payment lookup error")) return new Response("", { status: 503 });
      if (scenario === "malformed") return Response.json({ payload: {} });
      const b = { ...booking };
      if (scenario === "enquiry") b.status = "in_progress";
      if (scenario === "cancelled") b.status = "rejected";
      if (scenario === "wrong email") b.email = "someone@example.com";
      if (scenario === "wrong venue") b.venue_id = "another-venue";
      if (scenario === "wrong date") b.date = "2026-09-18";
      if (scenario === "wrong type") b.type = { id: "different-show" };
      if (scenario === "wrong guests") b.num_people = 4;
      return Response.json({ payload: { bookings: scenario === "missing" || (paid && scenario !== "paid") ? [] : [b] } });
    });
    const res = response();
    try {
      await verify({ method: "POST", body } as any, res as any);
      assert.equal(res.headers["Cache-Control"], "no-store");
      assert.equal(res.data.depositVerified, scenario === "paid");
      const expected = ["paid", "unpaid", "payment lookup error"].includes(scenario) ? "confirmed" : scenario === "enquiry" ? "enquiry" : scenario === "cancelled" ? "cancelled" : "unverified";
      assert.equal(res.data.status, expected);
      assert.equal(res.data.verified, expected !== "unverified");
      assert.ok(calls >= 1);
      assert.equal(res.data.email, undefined);
    } finally {
      for (const [i, key] of ["DMN_APP_ID", "DMN_API_KEY"].entries()) {
        if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i];
      }
    }
  });
}

test("forged success without a booking reference never reaches DMN", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("Should not call DMN"); });
  for (const reference of [undefined, "Returned from DesignMyNight", "../../bookings", ""]) {
    const res = response();
    await verify({ method: "POST", body: { ...body, reference } } as any, res as any);
    assert.deepEqual(res.data, { verified: false, status: "unverified", depositVerified: false });
  }
});

test("DMN POST callback preserves the return session identifier", async () => {
  const res = response();
  await returnHandler({ method: "POST", query: { return_id: "session-1" }, body: { reference: "DMN-123456", status: "complete", email: "guest@example.com" } } as any, res as any);
  assert.equal(res.code, 303);
  const url = new URL(res.data, "https://calendar.test");
  assert.equal(url.searchParams.get("return_id"), "session-1");
  assert.equal(url.searchParams.get("reference"), "DMN-123456");
  assert.equal(url.searchParams.get("verified"), null);
});
