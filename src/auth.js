'use strict';

const admin = require('firebase-admin');

if (!admin.apps.length) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : null;

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID || 'resume-assist-f8361',
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL || 'firebase-adminsdk-fbsvc@resume-assist-f8361.iam.gserviceaccount.com',
      privateKey: privateKey || require('./firebase-key.json').private_key,
    }),
  });
}

async function authMiddleware(req, res, next) {
  if (req.path === '/health') return next();

  // Legacy API_KEY for cron + CLI
  const apiKey = req.header('x-api-key');
  if (process.env.API_KEY && apiKey === process.env.API_KEY) {
    req.userId = process.env.SYSTEM_USER_ID || 'me';
    return next();
  }

  // Firebase JWT
  const authHeader = req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const token = authHeader.replace('Bearer ', '');
    const decoded = await admin.auth().verifyIdToken(token);
    req.userId = decoded.uid;
    req.userEmail = decoded.email;
    req.userName = decoded.name;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid token' });
  }
}

module.exports = { authMiddleware };
