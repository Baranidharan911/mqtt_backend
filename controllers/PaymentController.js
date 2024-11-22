const db = require('../config/firebaseConfig');

const PaymentController = {
  addPayment: async (paymentData) => {
    try {
      await db.collection('Payments').doc(paymentData.paymentId).set(paymentData);
      return { message: 'Payment added successfully' };
    } catch (error) {
      throw new Error('Error adding payment: ' + error.message);
    }
  },

  getPayments: async () => {
    try {
      const paymentsSnapshot = await db.collection('Payments').get();
      const payments = paymentsSnapshot.docs.map(doc => doc.data());
      return payments;
    } catch (error) {
      throw new Error('Error fetching payments: ' + error.message);
    }
  },

  updatePayment: async (id, paymentData) => {
    try {
      await db.collection('Payments').doc(id).update(paymentData);
      return { message: 'Payment updated successfully' };
    } catch (error) {
      throw new Error('Error updating payment: ' + error.message);
    }
  },

  deletePayment: async (id) => {
    try {
      await db.collection('Payments').doc(id).delete();
      return { message: 'Payment deleted successfully' };
    } catch (error) {
      throw new Error('Error deleting payment: ' + error.message);
    }
  }
};

module.exports = PaymentController;
