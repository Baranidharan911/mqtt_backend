const customerSchema = {
  customerId: String,
  name: String,
  email: String,
  phone: String,
  password: String, // Add password field
  devices: [String], // Array of device IDs
  subscription: String,
  startDate: Date,
  endDate: Date,
  litersAlloted: Number
};

module.exports = customerSchema;
