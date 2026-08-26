import express from "express";
import { errorMiddleware } from "./middlewares/error.middleware";
import healthRouter from "./routes/health.routes";
import productRouter from "./routes/product.routes";
import restockRouter from "./routes/restock.routes";
import slotRouter from "./routes/slot.routes";
import transactionRouter from "./routes/transaction.routes";

const app = express();

app.use((request, response, next) => {
  response.setHeader("Access-Control-Allow-Origin", "http://localhost:5173");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }

  next();
});

app.use(express.json());
app.use("/health", healthRouter);
app.use("/api/v1/products", productRouter);
app.use("/api/v1/slots", slotRouter);
app.use("/api/v1/transactions", transactionRouter);
app.use("/api/v1/restocks", restockRouter);
app.use(errorMiddleware);

export default app;
