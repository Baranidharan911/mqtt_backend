const express = require('express');
const bodyParser = require('body-parser');
const mqtt = require('mqtt');
const db = require('./config/firebaseConfig');
const cors = require('cors');
const WebSocket = require('ws');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
app.use('/api', require('./routes'));

// MQTT Client Configuration with Authentication
const mqttOptions = {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
};

const client = mqtt.connect(process.env.MQTT_BROKER_URL || 'mqtt://165.22.244.151:1883', mqttOptions);

// WebSocket server
const server = app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('New client connected');

  ws.on('message', (message) => {
    console.log('Received message from client:', message);
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// Track last message times and daily usage
const deviceStatus = {};
const dailyUsage = {};

client.on('connect', () => {
  console.log('Connected to MQTT broker');
  client.subscribe('ro_water_system/status/#', (err) => {
    if (err) {
      console.error('Failed to subscribe to topic', err);
    } else {
      console.log('Subscribed to topic: ro_water_system/status/#');
    }
  });
});

client.on('message', async (topic, message) => {
  try {
    const macAddress = topic.split('/')[2];
    const data = JSON.parse(message.toString());
    const currentTime = new Date().getTime();
    const currentDate = new Date().toISOString().split('T')[0]; // Get current date in YYYY-MM-DD format

    // Update the message time
    deviceStatus[macAddress] = currentTime;

    // Initialize daily usage for today if not already done
    if (!dailyUsage[macAddress]) {
      dailyUsage[macAddress] = { date: currentDate, liter: 0 };
    }

    // Accumulate daily usage
    if (dailyUsage[macAddress].date === currentDate) {
      dailyUsage[macAddress].liter += data.liter / 1000; // Convert ml to liters
    } else {
      // Store the previous day's usage in Firestore
      const previousDate = dailyUsage[macAddress].date;
      await db.collection('Devices').doc(macAddress).update({
        [`dailyUsage.${previousDate}`]: dailyUsage[macAddress].liter,
      });

      // Reset for the new day
      dailyUsage[macAddress] = { date: currentDate, liter: data.liter / 1000 }; // Convert ml to liters
    }

    // Update the Firestore document
    await db.collection('Devices').doc(macAddress).set({
      ...data,
      lastMessageTime: currentTime,
      online: true,
      dailyUsage: {
        ...dailyUsage[macAddress],
      },
    }, { merge: true });

    // Notify all connected WebSocket clients about the update
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ACK', device: { ...data, id: macAddress } }));
      }
    });

    console.log(`Data for device ${macAddress} stored in Firebase at ${new Date(currentTime)}`);

    // If the received message has 'control' or 'id', send subscription status to the broker
    if (data.id || data.control !== undefined) {
      const deviceDoc = await db.collection('Devices').doc(macAddress).get();
      const deviceData = deviceDoc.data();
      const subscriptionStatus = deviceData.subscription ? 'active' : 'inactive';
      const resetStatus = !deviceData.subscription; // Set reset to true if subscription is false

      const subscriptionMessage = JSON.stringify({
        subscriptionStatus,
        subscription: deviceData.subscription,
        reset: resetStatus, // Dynamically set reset status
      });
      const subscriptionTopic = `ro_water_system/status/${macAddress}`;

      client.publish(subscriptionTopic, subscriptionMessage, (err) => {
        if (err) {
          console.error('Failed to publish subscription update message:', err);
        } else {
          console.log(`Subscription update sent to ${subscriptionTopic}: ${subscriptionMessage}`);
        }
      });
    }


  } catch (error) {
    console.error('Error processing message:', error);
  }
});

// Schedule a task to store daily usage at midnight
const scheduleDailyUsageUpdate = () => {
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 0, 0); // Set time to midnight

  const timeUntilMidnight = nextMidnight.getTime() - now.getTime();

  setTimeout(async () => {
    console.log('Running daily usage update task at midnight');

    for (const macAddress of Object.keys(dailyUsage)) {
      const previousDate = dailyUsage[macAddress].date;
      const usage = dailyUsage[macAddress].liter;

      // Store the previous day's usage in Firestore
      console.log(`Storing usage for device ${macAddress} for date ${previousDate}: ${usage} liters`);
      await db.collection('Devices').doc(macAddress).update({
        [`dailyUsage.${previousDate}`]: usage,
      });

      // Update the date for the new day without resetting the liter value
      dailyUsage[macAddress].date = new Date().toISOString().split('T')[0];
      console.log(`Updated date for device ${macAddress} for the new day without resetting the liter value`);
    }

    // Reschedule the task for the next day
    scheduleDailyUsageUpdate();
  }, timeUntilMidnight);
};

// Start the daily usage update schedule
scheduleDailyUsageUpdate();


// Function to check and update subscription status
const checkAndUpdateSubscription = async (macAddress, usedLiters) => {
  const deviceRef = db.collection('Devices').doc(macAddress);
  const deviceSnap = await deviceRef.get();

  if (!deviceSnap.exists) {
    console.error('Device not found:', macAddress);
    return;
  }

  const deviceData = deviceSnap.data();
  const currentTime = new Date().getTime();
  const endDate = new Date(deviceData.endDate).getTime();
  const totalLiters = deviceData.totalLiter / 1000; // Convert to liters

  if (currentTime > endDate || usedLiters > totalLiters) {
    console.log(`Ending subscription for device ${macAddress}`);

    // Add current plan to pastPlans
    const pastPlans = deviceData.pastPlans || [];
    pastPlans.push({
      planName: deviceData.planName,
      startDate: deviceData.startDate,
      endDate: deviceData.endDate,
      totalLiter: deviceData.totalLiter,
    });

    await deviceRef.set({
      subscriptionStatus: 'inactive',
      subscription: false,
      pastPlans,
    }, { merge: true });

    // Notify WebSocket clients
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'UPDATE',
          device: { id: macAddress, subscriptionStatus: 'inactive', subscription: false },
        }));
      }
    });

    // Send update to broker
    const subscriptionMessage = JSON.stringify({
      subscriptionStatus: 'inactive',
      subscription: false,
      reset: true, // Reset value for inactive subscriptions
    });

    const subscriptionTopic = `ro_water_system/status/${macAddress}`;

    client.publish(subscriptionTopic, subscriptionMessage, (err) => {
      if (err) {
        console.error('Failed to publish subscription update message:', err);
      } else {
        console.log(`Subscription update sent to ${subscriptionTopic}: ${subscriptionMessage}`);
      }
    });
  }
};


// Periodically check device status and update online/offline status
setInterval(async () => {
  const currentTime = new Date().getTime();
  for (const [macAddress, lastMessageTime] of Object.entries(deviceStatus)) {
    const timeSinceLastMessage = currentTime - lastMessageTime;
    const isOffline = timeSinceLastMessage > 60000; // 1 minute threshold
    const deviceRef = db.collection('Devices').doc(macAddress);
    const deviceSnap = await deviceRef.get();
    const deviceData = deviceSnap.data();

    if (isOffline && deviceData.online) {
      // Mark device as offline
      await deviceRef.set({
        online: false,
      }, { merge: true });

      // Notify all connected WebSocket clients about the update
      wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'UPDATE', device: { id: macAddress, online: false } }));
        }
      });

      console.log(`Device ${macAddress} marked as offline after ${timeSinceLastMessage / 1000} seconds`);
    } else if (!isOffline && !deviceData.online) {
      // Mark device as online (if it was previously marked offline and we receive a new message)
      await deviceRef.set({
        online: true,
      }, { merge: true });

      // Notify all connected WebSocket clients about the update
      wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'UPDATE', device: { id: macAddress, online: true } }));
        }
      });

      console.log(`Device ${macAddress} marked as online`);
    }
  }
}, 60000); // Check every minute

client.on('error', (err) => {
  console.error('MQTT connection error:', err);
});

client.on('offline', () => {
  console.warn('MQTT broker is offline');
});

client.on('reconnect', () => {
  console.log('Reconnecting to MQTT broker...');
});

// New route for publishing control messages
app.post('/api/mqtt/publish', (req, res) => {
  const { deviceId, toggle } = req.body;

  if (!deviceId || toggle === undefined) {
    return res.status(400).send({ message: 'Device ID and toggle status are required' });
  }

  const topic = `ro_water_system/status/${deviceId}`;
  const message = JSON.stringify({ type: 'toggle', toggle });

  client.publish(topic, message, (err) => {
    if (err) {
      console.error('Failed to publish message:', err);
      return res.status(500).send({ message: 'Failed to send device command' });
    }

    console.log(`Command sent to ${topic}: ${message}`);
    res.status(200).send({ message: 'Device command sent successfully' });
  });
});

// Route to update subscription status
app.post('/api/devices/update-subscription', async (req, res) => {
  const { deviceId, subscriptionStatus } = req.body;

  if (!deviceId || subscriptionStatus === undefined) {
    return res.status(400).send({ message: 'Device ID and subscription status are required' });
  }

  try {
    const deviceRef = db.collection('Devices').doc(deviceId);
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + 5 * 60 * 1000); // Subscription duration, adjust as needed

    await deviceRef.set({
      subscriptionStatus,
      subscription: subscriptionStatus === 'active',
      startDate: subscriptionStatus === 'active' ? startDate.toISOString() : null,
      endDate: subscriptionStatus === 'active' ? endDate.toISOString() : null,
    }, { merge: true });

    // Notify all connected WebSocket clients about the update
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'UPDATE',
          device: {
            id: deviceId,
            subscriptionStatus,
            subscription: subscriptionStatus === 'active',
          },
        }));
      }
    });

    // Send update to broker
    const subscriptionMessage = JSON.stringify({
      subscriptionStatus,
      subscription: subscriptionStatus === 'active',
      reset: subscriptionStatus !== 'active', // Reset value for inactive subscriptions
    });

    const subscriptionTopic = `ro_water_system/status/${deviceId}`;

    client.publish(subscriptionTopic, subscriptionMessage, (err) => {
      if (err) {
        console.error('Failed to publish subscription update message:', err);
        return res.status(500).send({ message: 'Failed to send subscription update to broker' });
      }

      console.log(`Subscription update sent to ${subscriptionTopic}: ${subscriptionMessage}`);
      res.status(200).send({ message: 'Subscription status updated successfully' });
    });

    if (subscriptionStatus === 'active') {
      // Schedule status change after subscription ends
      setTimeout(async () => {
        console.log(`Changing subscription status for device ${deviceId} to inactive`);
        await updateDoc(deviceRef, { subscriptionStatus: 'inactive', subscription: false });
        // Notify WebSocket clients
        wss.clients.forEach((ws) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'UPDATE',
              device: { id: deviceId, subscriptionStatus: 'inactive', subscription: false },
            }));
          }
        });

        // Send reset message to broker
        const resetMessage = JSON.stringify({
          subscriptionStatus: 'inactive',
          subscription: false,
          reset: true,
        });

        client.publish(subscriptionTopic, resetMessage, (err) => {
          if (err) {
            console.error('Failed to publish reset message:', err);
          } else {
            console.log(`Reset message sent to ${subscriptionTopic}: ${resetMessage}`);
          }
        });
      }, endDate.getTime() - startDate.getTime());
    }
  } catch (error) {
    console.error('Error updating subscription status:', error);
    res.status(500).send({ message: 'Failed to update subscription status' });
  }
});

// Function to update device status periodically
const updateDeviceStatusPeriodically = async () => {
  const currentTime = new Date().getTime();
  for (const [macAddress, lastMessageTime] of Object.entries(deviceStatus)) {
    const timeSinceLastMessage = currentTime - lastMessageTime;
    const isOffline = timeSinceLastMessage > 60000; // 1 minute threshold
    const deviceRef = db.collection('Devices').doc(macAddress);
    const deviceSnap = await deviceRef.get();
    const deviceData = deviceSnap.data();

    if (isOffline && deviceData.online) {
      // Mark device as offline
      await deviceRef.set({
        online: false,
      }, { merge: true });

      // Notify all connected WebSocket clients about the update
      wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'UPDATE', device: { id: macAddress, online: false } }));
        }
      });

      console.log(`Device ${macAddress} marked as offline after ${timeSinceLastMessage / 1000} seconds`);
    } else if (!isOffline && !deviceData.online) {
      // Mark device as online (if it was previously marked offline and we receive a new message)
      await deviceRef.set({
        online: true,
      }, { merge: true });

      // Notify all connected WebSocket clients about the update
      wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'UPDATE', device: { id: macAddress, online: true } }));
        }
      });

      console.log(`Device ${macAddress} marked as online`);
    }
  }
};

// Periodically check device status and update online/offline status
setInterval(updateDeviceStatusPeriodically, 60000); // Check every minute

client.on('error', (err) => {
  console.error('MQTT connection error:', err);
});

client.on('offline', () => {
  console.warn('MQTT broker is offline');
});

client.on('reconnect', () => {
  console.log('Reconnecting to MQTT broker...');
});

app.get('/download-image', async (req, res) => {
  const { imageUrl } = req.query;

  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer'
    });

    res.set('Content-Type', response.headers['content-type']);
    res.send(response.data);
  } catch (error) {
    console.error('Error downloading image:', error);
    res.status(500).send('Failed to download image');
  }
});
