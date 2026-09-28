import express from "express";
import employeeRouter from "./routes/employee.routes";
import { errorMiddleware } from "./middlewares/error.middleware";
import healthRouter from "./routes/health.routes";
import productRouter from "./routes/product.routes";
import restockRouter from "./routes/restock.routes";
import slotRouter from "./routes/slot.routes";
import transactionRouter from "./routes/transaction.routes";
import kioskSessionRouter from "./routes/kiosk-session.routes";

const app = express();
const allowedOrigins = new Set(
  (process.env.CORS_ALLOWED_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

app.use((request, response, next) => {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }

  next();
});

app.use(
  express.json({
    verify(request, _response, buffer) {
      (request as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
    },
  }),
);
app.use("/health", healthRouter);
app.use("/api/v1/employees", employeeRouter);
app.use("/api/v1/products", productRouter);
app.use("/api/v1/slots", slotRouter);
app.use("/api/v1/transactions", transactionRouter);
app.use("/api/v1/restocks", restockRouter);
app.use("/api/v1/kiosk-sessions", kioskSessionRouter);
app.use(errorMiddleware);

export default app;
