// mongo-init.js
db = db.getSiblingDB('conventioner');

db.createCollection('users');
db.createCollection('markets');
db.createCollection('source_data');
db.createCollection('organizations');
db.createCollection('attendance');
