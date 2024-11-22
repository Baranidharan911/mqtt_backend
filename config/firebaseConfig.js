const admin = require('firebase-admin');
const serviceAccount = require('../special.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://roapp-de944.firebaseio.com'
});

const db = admin.firestore();

module.exports = db,admin;
