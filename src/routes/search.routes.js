import { Router } from "express";
import  handleSearchStream  from "../controllers/search.controller.js"
import  verifyFirebaseToken  from "../middleware/auth.js";
const router = Router();

// GET SSE
router.get("/stream", verifyFirebaseToken, handleSearchStream);

export default router;


