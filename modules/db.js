const mongodb = require('mongodb');

module.exports = mongodb.MongoClient
    .connect("mongodb://localhost:27017/")
    .then(connection => connection.db("server-setup"));