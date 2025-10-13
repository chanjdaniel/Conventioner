// mongo-init.js
db = db.getSiblingDB('market_maker');

db.createCollection('users');
db.createCollection('markets');
db.createCollection('source_data');

db.users.insertOne({ initialized: true });
db.markets.insertOne({ initialized: true });
db.source_data.insertOne({ initialized: true });
