const deviceSchema = {
  id: String,
  control: Boolean,
  liter: Number,
  damper: Boolean,
  backup: Boolean,
  subscription: Boolean,
  toggle: Boolean,
  totalLiter: Number,
  reset:Boolean
};

module.exports = deviceSchema;
