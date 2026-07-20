/**
 * Thin entrypoint — implementation lives in ./sms/*
 * so server.js can keep: const sms = require('./sms')
 */
module.exports = require('./sms/index');
