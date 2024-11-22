const { admin } = require('../config/firebaseConfig');
const db = require('../config/firebaseConfig').db;

const AuthController = {
  register: async (req, res) => {
    const { email, password, name, phone } = req.body;
    try {
      const userRecord = await admin.auth().createUser({
        email,
        password,
        displayName: name,
      });

      await db.collection('Users').doc(userRecord.uid).set({
        uid: userRecord.uid,
        email,
        name,
        phone,
      });

      res.status(201).send({ message: 'User registered successfully', uid: userRecord.uid });
    } catch (error) {
      res.status(400).send({ error: error.message });
    }
  },

  login: async (req, res) => {
    const { email, password } = req.body;
    try {
      const user = await admin.auth().getUserByEmail(email);
      const token = await admin.auth().createCustomToken(user.uid);

      res.status(200).send({ token });
    } catch (error) {
      res.status(400).send({ error: error.message });
    }
  },
};

module.exports = AuthController;
