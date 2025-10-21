import { Router } from "express";
import  verifyFirebaseToken  from "../middleware/auth.js";
import { getProductById } from "../controllers/productDetails.controller.js";


const router = Router();

router.get("/:idCollection/:idProduct", verifyFirebaseToken, getProductById );

export default router;


