import admin from '../config/firebase.js'


async function verifyFirebaseToken(req, res, next) {
  try {
    let token = req.headers.authorization?.split(" ")[1];
    if (!token && req.query.token) token = req.query.token;

    if (!token) return res.status(401).json({ error: "No token provided" });

    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    console.error("Auth error:", err);
    res.status(401).json({ error: "Invalid token" });
  }
}


export default verifyFirebaseToken;