const bcrypt = require('bcrypt');
const db = require('../config/firebaseConfig');
const admin = require('firebase-admin');

const CustomerController = {
  registerCustomer: async (customerData) => {
    try {
      const { customerId, name, email, phone, password, deviceId } = customerData;
      const hashedPassword = await bcrypt.hash(password, 10);
      const customerRef = db.collection('Customers').doc(customerId);
      const customerDoc = await customerRef.get();

      if (customerDoc.exists) {
        await customerRef.update({
          devices: admin.firestore.FieldValue.arrayUnion(deviceId)
        });
      } else {
        await customerRef.set({
          customerId,
          name,
          email,
          phone,
          password: hashedPassword,
          devices: [deviceId]
        });
      }

      return { message: 'Customer registered successfully' };
    } catch (error) {
      throw new Error('Error registering customer: ' + error.message);
    }
  },

  loginCustomer: async (loginData) => {
    try {
      const { email, phone, password } = loginData;
      const customersSnapshot = await db.collection('Customers')
        .where('email', '==', email)
        .get();
      
      if (customersSnapshot.empty) {
        const phoneSnapshot = await db.collection('Customers')
          .where('phone', '==', phone)
          .get();
        
        if (phoneSnapshot.empty) {
          throw new Error('No matching customer found');
        }

        const customer = phoneSnapshot.docs[0].data();
        const isPasswordValid = await bcrypt.compare(password, customer.password);
        if (!isPasswordValid) {
          throw new Error('Invalid password');
        }

        return customer;
      }

      const customer = customersSnapshot.docs[0].data();
      const isPasswordValid = await bcrypt.compare(password, customer.password);
      if (!isPasswordValid) {
        throw new Error('Invalid password');
      }

      return customer;
    } catch (error) {
      throw new Error('Error logging in customer: ' + error.message);
    }
  },

  getCustomerProducts: async (customerId) => {
    try {
      const customerRef = db.collection('Customers').doc(customerId);
      const customerDoc = await customerRef.get();

      if (!customerDoc.exists) {
        throw new Error('Customer not found');
      }

      const customerData = customerDoc.data();
      const devicePromises = customerData.devices.map(deviceId =>
        db.collection('Devices').doc(deviceId).get()
      );

      const devices = await Promise.all(devicePromises);
      const deviceData = devices.map(device => device.data());

      return { customerData, deviceData };
    } catch (error) {
      throw new Error('Error fetching customer products: ' + error.message);
    }
  },

  updateCustomer: async (customerId, customerData) => {
    try {
      await db.collection('Customers').doc(customerId).update(customerData);
      return { message: 'Customer updated successfully' };
    } catch (error) {
      throw new Error('Error updating customer: ' + error.message);
    }
  },

  deleteCustomer: async (customerId) => {
    try {
      await db.collection('Customers').doc(customerId).delete();
      return { message: 'Customer deleted successfully' };
    } catch (error) {
      throw new Error('Error deleting customer: ' + error.message);
    }
  },

  getAllCustomers: async () => {
    try {
      const customersSnapshot = await db.collection('Customers').get();
      const customers = customersSnapshot.docs.map(doc => doc.data());
      return customers;
    } catch (error) {
      throw new Error('Error fetching customers: ' + error.message);
    }
  }
};

module.exports = CustomerController;
