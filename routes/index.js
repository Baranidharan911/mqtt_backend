const express = require('express');
const DeviceController = require('../controllers/DeviceController');
const AuthController = require('../controllers/authController');

const router = express.Router();

router.post('/devices/control', DeviceController.updateDeviceControl);
router.patch('/devices/:id', DeviceController.updateDeviceControl);

// New route for removing customer data from a device
router.patch('/devices/:id/remove-customer', DeviceController.removeCustomerFromDevice);

// Auth routes
router.post('/register', AuthController.register);
router.post('/login', AuthController.login);

// Device routes
router.post('/devices', async (req, res) => {
  try {
    const response = await DeviceController.addDevice(req.body);
    res.status(200).send(response);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

router.get('/devices', async (req, res) => {
  try {
    const response = await DeviceController.getDevices();
    res.status(200).send(response);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

router.put('/devices/:id', async (req, res) => {
  try {
    const response = await DeviceController.updateDevice(req.params.id, req.body);
    res.status(200).send(response);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

router.delete('/devices/:id', async (req, res) => {
  try {
    const response = await DeviceController.deleteDevice(req.params.id);
    res.status(200).send(response);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

router.get('/devices/total', async (req, res) => {
  try {
    const response = await DeviceController.getTotalDevices();
    res.status(200).send(response);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

router.get('/devices/active', async (req, res) => {
  try {
    const response = await DeviceController.getActiveDevices();
    res.status(200).send(response);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

router.get('/devices/inactive', async (req, res) => {
  try {
    const response = await DeviceController.getInactiveDevices();
    res.status(200).send(response);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

module.exports = router;
