const mongoose = require('mongoose');

// Every field is optional: the client sends what its browser will tell it and
// the route keeps only what sanitiseReportEnvironment() admits.
const reportEnvironmentSchema = new mongoose.Schema({
  userAgent:         String,
  uaPlatform:        String,
  uaPlatformVersion: String,
  uaModel:           String,
  uaArchitecture:    String,
  uaBitness:         String,
  uaMobile:          Boolean,
  uaBrands:          { type: [{ brand: String, version: String, _id: false }], default: undefined },
  screenWidth:       Number,
  screenHeight:      Number,
  viewportWidth:     Number,
  viewportHeight:    Number,
  dpr:               Number,
  orientation:       String,
  touchPoints:       Number,
  language:          String,
  timezone:          String,
  online:            Boolean,
  connection:        String,
  cores:             Number,
  memory:            Number,
  webglVendor:       String,
  webglRenderer:     String,
  theme:             String,
  displayMode:       String,
  fullscreen:        Boolean,
  gamepads:          { type: [String], default: undefined },
}, { _id: false });

module.exports = reportEnvironmentSchema;
