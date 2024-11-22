const db = require('../config/firebaseConfig');
const mqtt = require('mqtt');
const client = mqtt.connect('mqtt://165.22.244.151:1883');

const pendingAcks = {};

const DeviceController = {
  addDevice: async (deviceData) => {
    try {
      if (!deviceData.id) {
        throw new Error("Device ID is required");
      }
      await db.collection('Devices').doc(deviceData.id).set(deviceData);
      return { message: 'Device added successfully' };
    } catch (error) {
      throw new Error('Error adding device: ' + error.message);
    }
  },

  getDevices: async () => {
    try {
      const devicesSnapshot = await db.collection('Devices').get();
      const devices = devicesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return devices;
    } catch (error) {
      throw new Error('Error fetching devices: ' + error.message);
    }
  },

  updateDevice: async (id, deviceData) => {
    try {
      if (!id) {
        throw new Error("Device ID is required");
      }
      await db.collection('Devices').doc(id).update(deviceData);
      return { message: 'Device updated successfully' };
    } catch (error) {
      throw new Error('Error updating device: ' + error.message);
    }
  },

  deleteDevice: async (id) => {
    try {
      if (!id) {
        throw new Error("Device ID is required");
      }
      await db.collection('Devices').doc(id).delete();
      return { message: 'Device deleted successfully' };
    } catch (error) {
      throw new Error('Error deleting device: ' + error.message);
    }
  },

  removeCustomerData: async (id) => {
    try {
      if (!id) {
        throw new Error("Device ID is required");
      }
      await db.collection('Devices').doc(id).update({
        customer: null,
      });
      return { message: 'Customer data removed successfully' };
    } catch (error) {
      throw new Error('Error removing customer data: ' + error.message);
    }
  },

  getDevicesWithCustomerInfo: async (devices) => {
    const deviceData = [];
    const usersSnapshot = await db.collection('Users').get();
    const users = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    for (const device of devices) {
      const user = users.find(user => user.phone === device.phone);
      deviceData.push({
        ...device,
        customer: user ? { name: user.name, email: user.email, phone: user.phone, address: user.address, uid: user.id } : { name: 'N/A', email: 'N/A', phone: 'N/A', address: 'N/A', uid: 'N/A' }
      });
    }
    return deviceData;
  },

  removeCustomerFromDevice: async (req, res) => {
    const { id } = req.params;

    try {
      await db.collection('Devices').doc(id).update({
        phone: 'N/A',
      });
      res.status(200).send({ message: 'Customer data removed successfully' });
    } catch (error) {
      console.error('Error removing customer data:', error);
      res.status(500).send({ message: 'Failed to remove customer data' });
    }
  },

  getTotalDevices: async () => {
    try {
      const devicesSnapshot = await db.collection('Devices').get();
      const devices = devicesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return await DeviceController.getDevicesWithCustomerInfo(devices);
    } catch (error) {
      throw new Error('Error fetching total devices: ' + error.message);
    }
  },

  getActiveDevices: async () => {
    try {
      const devicesSnapshot = await db.collection('Devices').where('subscription', '==', true).get();
      const devices = devicesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return await DeviceController.getDevicesWithCustomerInfo(devices);
    } catch (error) {
      throw new Error('Error fetching active devices: ' + error.message);
    }
  },

  getInactiveDevices: async () => {
    try {
      const devicesSnapshot = await db.collection('Devices').where('subscription', '==', false).get();
      const devices = devicesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const devicesWithCustomerInfo = await DeviceController.getDevicesWithCustomerInfo(devices);
      return devicesWithCustomerInfo.filter(device => device.customer.name !== 'N/A');
    } catch (error) {
      throw new Error('Error fetching inactive devices: ' + error.message);
    }
  },
  
  updateDeviceControl: async (req, res) => {
    const { id } = req.params;
    const { toggle } = req.body; // Change 'control' to 'toggle'

    try {
      const topic = `ro_water_system/status/${id}`;
      const message = JSON.stringify({ type: 'toggle', toggle });

      pendingAcks[id] = (success) => {
        if (success) {
          db.collection('Devices').doc(id).set({ toggle }, { merge: true });
          res.status(200).send({ message: 'Device control updated successfully' });
        } else {
          res.status(500).send({ message: 'Device control update failed' });
        }
      };

      client.publish(topic, message, (err) => {
        if (err) {
          console.error('Failed to publish message:', err);
          delete pendingAcks[id];
          return res.status(500).send({ message: 'Failed to send device control command' });
        }
        console.log(`Control command sent to ${topic}: ${message}`);
      });

      setTimeout(() => {
        if (pendingAcks[id]) {
          pendingAcks[id](false);
          delete pendingAcks[id];
        }
      }, 5000); // Wait for 5 seconds for acknowledgment

    } catch (error) {
      console.error('Error updating device control:', error);
      res.status(500).send({ message: 'Error updating device control', error });
    }
  },

  publishMqttMessage: (req, res) => {
    const { id, toggle } = req.body; // Change 'control' to 'toggle'
    const topic = `ro_water_system/status/${id}`;
    const message = JSON.stringify({ type: 'toggle', toggle });

    client.publish(topic, message, (err) => {
      if (err) {
        return res.status(500).send({ message: 'Error publishing MQTT message', error: err });
      }
      res.status(200).send({ message: 'MQTT message published successfully' });
    });
  },
};

client.on('message', (topic, message) => {
  const parts = topic.split('/');
  if (parts[0] === 'ro_water_system' && parts[1] === 'status') {
    const deviceId = parts[2];
    const data = JSON.parse(message.toString());

    if (data.type === 'status' && pendingAcks[deviceId]) {
      pendingAcks[deviceId](true);
      delete pendingAcks[deviceId];
    }

    db.collection('Devices').doc(deviceId).set({
      ...data,
      lastMessageTime: new Date().getTime(),
      online: true,
    }, { merge: true });
  }
});

module.exports = DeviceController;
