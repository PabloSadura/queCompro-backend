import { Router } from "express";
import  getUserHistory  from "../controllers/history.controller.js";
import  verifyFirebaseToken  from "../middleware/auth.js";


const router = Router();

router.get("/", verifyFirebaseToken, getUserHistory);

export default router;


