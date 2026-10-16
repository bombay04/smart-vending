import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { errorMiddleware } from "../middlewares/error.middleware";
import { createEmployeeRouter } from "./employee.routes";

async function postEmployeeRoute(nodeEnvironment: string, path: string): Promise<Response> {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/employees", createEmployeeRouter(nodeEnvironment));
  app.use(errorMiddleware);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const { port } = server.address() as AddressInfo;
    return await fetch(`http://127.0.0.1:${port}/api/v1/employees${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("mock employee authentication is unavailable in production", async () => {
  const response = await postEmployeeRoute("production", "/auth/mock");
  assert.equal(response.status, 404);
});

test("mock employee authentication remains registered outside production", async () => {
  const response = await postEmployeeRoute("development", "/auth/mock");
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "employeeCode must be a non-empty string.",
  });
});

test("real face authentication remains registered in production", async () => {
  const response = await postEmployeeRoute("production", "/auth/face");
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "sessionId must be a positive integer.",
  });
});
