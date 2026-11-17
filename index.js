'use strict';

const { verifyManifest } = require('./lib/verifier');
const integrity = require('./lib/integrity');

module.exports = {
  verifyManifest,
  ...integrity,
};
