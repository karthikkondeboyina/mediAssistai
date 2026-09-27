const EventEmitter = require('events');

class ApplicationEventBus extends EventEmitter {}

const eventBus = new ApplicationEventBus();

module.exports = eventBus;
