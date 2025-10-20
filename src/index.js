import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import searchRoutes from "./routes/search.routes.js";
import historyRoutes from "./routes/history.routes.js";
import geoLocation from "./routes/geo.routes.js";
import productDetail from "./routes/product.routes.js";
import whatsappRoutes from "./routes/whatsapp.routes.js";




dotenv.config()

const app = express();

//const allowedOrigins = 'http://localhost:4200';
const allowedOrigins = [process.env.FRONTEND_URL || 'http://localhost:4200'];

// Middlewares
app.use(cors({ 
  origin: allowedOrigins,   // no usar "*"
  credentials: true,        // permite enviar cookies / headers auth
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"] }));
app.use(express.json());

// Rutas
app.use("/api/search", searchRoutes);
app.use("/api/history", historyRoutes);
app.use("/api/geo", geoLocation);
app.use("/api/product", productDetail)

app.use('/api/whatsapp-webhook',whatsappRoutes)



app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal Server Error" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
