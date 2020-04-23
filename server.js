const express = require('express');
const { HOST, PORT } = require('./constants')

const app = express();

app.get('/', (req, res) => {
  res.send('It is working!!!');
});

app.listen(PORT, HOST);
console.log(`Running on http://${HOST}:${PORT}`);