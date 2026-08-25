import { Router } from "express";
import { listProducts } from "../controllers/product.controller";

const productRouter = Router();

productRouter.get("/", listProducts);

export default productRouter;
