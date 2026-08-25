import express from "express";
import healthRouter from "./routes/health.routes";
import productRouter from "./routes/product.routes";

const app = express();

app.use(express.json());
app.use("/health", healthRouter);
app.use("/api/v1/products", productRouter);

export default app;
