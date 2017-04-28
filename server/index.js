'use strict';

var path = require('path');
var createApp = require('./app');

var file = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'notes.json');
var port = Number(process.env.PORT) || 3000;
createApp({ file: file }).app.listen(port, function () {
  console.log('OfflineNotes sync server on http://localhost:' + port);
});
